/**
 * High-level FeelTech / FeelElec FY-series signal generator client.
 *
 * Works with any {@link Transport} implementation, allowing the same code to
 * run in Node.js (via `serialport`) and browsers (via the Web Serial API).
 */

import {
  buildCommand,
  cleanResponse,
  decodeAmplitudeV,
  decodeBool,
  decodeCounterDutyPct,
  decodeDutyPct,
  decodeFrequencyHz,
  decodeInt,
  decodeOffsetV,
  decodePhaseDeg,
  encodeAmplitudeV,
  encodeDutyPct,
  encodeFrequencyHz,
  encodeOffsetV,
  encodePhaseDeg,
} from "./protocol.js";
import {
  Channel,
  SweepObject,
  type Attenuation,
  type CascadeRole,
  type ChannelState,
  type CouplingMode,
  type DeviceFamily,
  FeelTechError,
  FeelTechProtocolError,
  FeelTechVerifyError,
  type FeelTechOptions,
  type FrequencyEncoding,
  type GateTime,
  type MeasurementResult,
  type ModulationMode,
  type ModulationSource,
  type SweepConfig,
  type SweepMode,
  type SweepSource,
  type SyncObject,
  type WaveformDescriptor,
} from "./types.js";
import {
  FY2300_ARBITRARY_COUNT,
  FY6900_ARBITRARY_COUNT,
} from "./waveforms.js";
import { normalizeWaveform, resampleWaveform } from "./waveform-utils.js";
import {
  listWaveforms as listWaveformsFor,
  resolveWaveform,
  waveformName,
} from "./waveforms.js";
import type { Transport } from "./transport.js";

/** Throw unless the value is a real channel (guards untyped JS callers). */
function assertChannel(channel: Channel): void {
  if (channel !== Channel.Main && channel !== Channel.Aux) {
    throw new FeelTechError(
      `Invalid channel ${channel} — use Channel.Main (0) or Channel.Aux (1)`,
    );
  }
}

/** Throw unless the value is a finite number. */
function assertFinite(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FeelTechError(`${name} must be a finite number, got ${value}`);
  }
}

/** Throw unless min <= value <= max. */
function assertRange(name: string, value: number, min: number, max: number): void {
  assertFinite(name, value);
  if (value < min || value > max) {
    throw new FeelTechError(`${name} must be between ${min} and ${max}, got ${value}`);
  }
}

/**
 * Choose write/read command codes based on channel.
 * The protocol uses "WM" / "RM" for the main channel, "WF" / "RF" for the auxiliary.
 */
function chCode(channel: Channel, suffix: string): string {
  assertChannel(channel);
  return (channel === Channel.Main ? "WM" : "WF") + suffix;
}
function chReadCode(channel: Channel, suffix: string): string {
  assertChannel(channel);
  return (channel === Channel.Main ? "RM" : "RF") + suffix;
}

export class FeelTech {
  private opts: Required<
    Pick<
      FeelTechOptions,
      "readTimeoutMs" | "readRetries" | "commandDelayMs" | "debug" | "verifyWrites" | "writeRetries"
    >
  > & {
    family: DeviceFamily;
    baudRate?: number;
    frequencyEncoding?: FrequencyEncoding;
    logger: (message: string, ...args: unknown[]) => void;
  };
  private commandLock = Promise.resolve();
  private detectedFamily: DeviceFamily = "Unknown";
  private model = "";
  private id = "";

  constructor(public readonly transport: Transport, options: FeelTechOptions = {}) {
    this.opts = {
      family: options.family ?? "Unknown",
      readTimeoutMs: options.readTimeoutMs ?? 1500,
      readRetries: options.readRetries ?? 2,
      verifyWrites: options.verifyWrites ?? true,
      writeRetries: options.writeRetries ?? 2,
      commandDelayMs: options.commandDelayMs ?? 0,
      debug: options.debug ?? false,
      ...(options.baudRate !== undefined ? { baudRate: options.baudRate } : {}),
      ...(options.frequencyEncoding !== undefined
        ? { frequencyEncoding: options.frequencyEncoding }
        : {}),
      logger:
        options.logger ??
        ((msg: string, ...rest: unknown[]) => console.log("[feeltech]", msg, ...rest)),
    };
    this.detectedFamily = this.opts.family;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Connection lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Open the underlying transport with parameters appropriate for the configured
   * family, then probe the device for model and family auto-detection.
   */
  async open(): Promise<void> {
    const family = this.opts.family;
    const baudRate =
      this.opts.baudRate ?? (family === "FY2300" ? 9600 : 115200);
    const stopBits: 1 | 2 = family === "FY2300" ? 1 : 2;

    await this.transport.open({
      baudRate,
      dataBits: 8,
      stopBits,
      parity: "none",
      flowControl: "none",
    });

    // Initialization handshake: clear any stale partial command in the device buffer.
    await this.transport.write("\n\n\n");
    await this.delay(150);
    await this.transport.flush();
    // Some firmwares send 3+ trailing newlines per response; drain anything still pending.
    await this.drainEmptyLines(60, 16);

    // Auto-detect model.
    try {
      this.model = await this.readModel();
      this.id = await this.readId();
      if (this.opts.family === "Unknown") {
        this.detectedFamily = this.guessFamily(this.model);
      } else {
        this.detectedFamily = this.opts.family;
      }
      this.log(`Detected model="${this.model}" id="${this.id}" family=${this.detectedFamily}`);
    } catch (err) {
      // If probe fails, keep going; the user may explicitly set family later.
      this.log("Model probe failed (continuing):", err);
    }
  }

  /** Close the underlying transport. */
  async close(): Promise<void> {
    await this.transport.close();
  }

  /** Detected (or configured) device family. */
  get family(): DeviceFamily {
    return this.detectedFamily;
  }

  /** Last-read device model string (set after `open()`). */
  get deviceModel(): string {
    return this.model;
  }

  /** Last-read device ID (set after `open()`). */
  get deviceId(): string {
    return this.id;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Low-level command primitives (public for power users)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Drain any trailing empty newlines from the input buffer.
   *
   * Verified empirically against an FY6300-60M:
   *   - Read commands (RM_/RF_) return `<value>\n\n` (1 trailing empty)
   *   - UMO returns `<value>\n\n\n\n` (3 trailing empties — special case)
   *   - Write commands (WM_/WF_) return `\n` (just 1 empty ack)
   *
   * `idleMs` is short by design — trailing newlines arrive within microseconds
   * of the value, so 20–30 ms is plenty.
   */
  private async drainEmptyLines(idleMs = 25, max = 6): Promise<void> {
    for (let i = 0; i < max; i++) {
      try {
        const line = await this.transport.readLine(idleMs);
        if (cleanResponse(line).length > 0) {
          this.log(`!! drained unexpected non-empty line: ${JSON.stringify(line)}`);
          return;
        }
      } catch {
        return; // idle — buffer is clean
      }
    }
  }

  /**
   * Send a write command. The FY6900 family returns a single `\n` ack;
   * the FY2300 returns nothing.
   */
  async sendWrite(code: string, value: string | number = ""): Promise<void> {
    await this.run(async () => {
      const line = buildCommand(code, value);
      this.log(`>> ${JSON.stringify(line)}`);
      await this.transport.write(line);
      // Consume the ack newline (FY6900) — short timeout, OK if absent (FY2300).
      try {
        const ack = await this.transport.readLine(200);
        if (cleanResponse(ack).length > 0) {
          this.log(`!! unexpected non-empty data after write: ${JSON.stringify(ack)}`);
        }
      } catch {
        /* no ack — fine */
      }
      if (this.opts.commandDelayMs > 0) await this.delay(this.opts.commandDelayMs);
    });
  }

  /**
   * Send a read query and return the trimmed response string.
   */
  async sendRead(code: string): Promise<string> {
    return this.run(async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= this.opts.readRetries; attempt++) {
        const line = buildCommand(code);
        this.log(`>> ${JSON.stringify(line)} (attempt ${attempt + 1})`);
        await this.transport.write(line);
        try {
          let value = "";
          // Read up to a few lines, skipping any stale empties, until we either
          // see a non-empty value or hit the deadline.
          const deadline = Date.now() + this.opts.readTimeoutMs;
          for (let i = 0; i < 6; i++) {
            const remain = Math.max(50, deadline - Date.now());
            const raw = await this.transport.readLine(remain);
            const cleaned = cleanResponse(raw);
            if (cleaned.length > 0) {
              value = cleaned;
              break;
            }
            if (Date.now() >= deadline) break;
          }
          this.log(`<< ${JSON.stringify(value)}`);
          // Drain any trailing empty lines that follow the value.
          await this.drainEmptyLines();
          if (value.length > 0) return value;
          // Empty — fall through and retry if attempts remain.
        } catch (err) {
          lastErr = err;
          this.log(`Read attempt ${attempt + 1} failed:`, err);
          await this.transport.flush();
        }
      }
      if (lastErr) throw lastErr instanceof Error ? lastErr : new FeelTechProtocolError(String(lastErr));
      return "";
    });
  }

  /**
   * Send a write and verify it was applied by reading the value back,
   * retrying on mismatch. FY firmware occasionally acks a write without
   * applying it (see docs/serial_protocol.md, known quirks) — verification
   * makes setters reliable. Skipped when `verifyWrites: false`.
   */
  private async setVerified<T>(
    describe: string,
    write: () => Promise<void>,
    read: () => Promise<T>,
    matches: (got: T) => boolean,
  ): Promise<void> {
    if (!this.opts.verifyWrites) {
      await write();
      return;
    }
    let got: T | undefined;
    const attempts = this.opts.writeRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await write();
      try {
        got = await read();
      } catch (err) {
        this.log(`!! verify read failed for ${describe} (attempt ${attempt}):`, err);
        continue;
      }
      if (matches(got)) return;
      this.log(`!! ${describe}: device reports ${String(got)} (attempt ${attempt}) — retrying`);
    }
    throw new FeelTechVerifyError(
      `${describe} was not applied by the device after ${attempts} attempts ` +
        `(readback: ${String(got)}). The firmware may have clamped the value or ` +
        `be in a state that ignores writes; pass verifyWrites: false to skip verification.`,
    );
  }

  /** Tolerance for verifying a voltage/percent/degree readback, per family. */
  private tol(fy2300: number, fy6900: number): number {
    return this.detectedFamily === "FY2300" ? fy2300 : fy6900;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Channel parameters (CH1 = Main, CH2 = Aux)
  // ──────────────────────────────────────────────────────────────────────────

  /** Set output waveform by code, name, or "Arbitrary<n>". */
  async setWaveform(channel: Channel, waveform: number | string): Promise<void> {
    const code = resolveWaveform(this.detectedFamily, channel, waveform);
    await this.setVerified(
      `set waveform ${waveform}`,
      () => this.sendWrite(chCode(channel, "W"), code.toString().padStart(2, "0")),
      () => this.getWaveform(channel),
      (got) => got === code,
    );
  }

  /** Read the current waveform code. */
  async getWaveform(channel: Channel): Promise<number> {
    const raw = await this.sendRead(chReadCode(channel, "W"));
    return decodeInt(raw);
  }

  /** Read the current waveform name (resolved from the device family). */
  async getWaveformName(channel: Channel): Promise<string> {
    const code = await this.getWaveform(channel);
    return waveformName(this.detectedFamily, channel, code);
  }

  /** Set output frequency in Hz. */
  async setFrequency(channel: Channel, hz: number): Promise<void> {
    assertFinite("frequency", hz);
    if (hz < 0) throw new FeelTechError(`frequency must be >= 0 Hz, got ${hz}`);
    const value = encodeFrequencyHz(this.detectedFamily, hz, this.opts.frequencyEncoding);
    // With a frequencyEncoding override the firmware's readback format is
    // unknown (that's why the override exists), so skip verification.
    const familyDefault: FrequencyEncoding = this.detectedFamily === "FY2300" ? "uHz" : "hz";
    if (this.opts.frequencyEncoding !== undefined && this.opts.frequencyEncoding !== familyDefault) {
      await this.sendWrite(chCode(channel, "F"), value);
      return;
    }
    // FY2300 reads frequency back as integer Hz. FY6900-family devices
    // quantize to the DDS resolution (~0.065 Hz = clock/2³², measured on an
    // FY6300-60M: set 12345.678 → reads 12345.612464), so allow 0.1 Hz.
    const tolerance = this.tol(1, 0.1 + hz * 1e-9);
    await this.setVerified(
      `set frequency ${hz} Hz`,
      () => this.sendWrite(chCode(channel, "F"), value),
      () => this.getFrequency(channel),
      (got) => Math.abs(got - hz) <= tolerance,
    );
  }

  /** Read output frequency in Hz. */
  async getFrequency(channel: Channel): Promise<number> {
    const raw = await this.sendRead(chReadCode(channel, "F"));
    return decodeFrequencyHz(this.detectedFamily, raw);
  }

  /** Set output amplitude in volts (peak-to-peak). */
  async setAmplitude(channel: Channel, volts: number): Promise<void> {
    assertFinite("amplitude", volts);
    if (volts < 0) throw new FeelTechError(`amplitude must be >= 0 V, got ${volts}`);
    const value = encodeAmplitudeV(this.detectedFamily, volts);
    await this.setVerified(
      `set amplitude ${volts} V`,
      () => this.sendWrite(chCode(channel, "A"), value),
      () => this.getAmplitude(channel),
      (got) => Math.abs(got - volts) <= this.tol(0.01, 1e-4),
    );
  }

  /** Read output amplitude in volts. */
  async getAmplitude(channel: Channel): Promise<number> {
    const raw = await this.sendRead(chReadCode(channel, "A"));
    return decodeAmplitudeV(this.detectedFamily, raw);
  }

  /** Set DC offset in volts. */
  async setOffset(channel: Channel, volts: number): Promise<void> {
    assertFinite("offset", volts);
    const value = encodeOffsetV(this.detectedFamily, volts);
    await this.setVerified(
      `set offset ${volts} V`,
      () => this.sendWrite(chCode(channel, "O"), value),
      () => this.getOffset(channel),
      (got) => Math.abs(got - volts) <= this.tol(0.01, 1e-3),
    );
  }

  /** Read DC offset in volts. */
  async getOffset(channel: Channel): Promise<number> {
    const raw = await this.sendRead(chReadCode(channel, "O"));
    return decodeOffsetV(this.detectedFamily, raw);
  }

  /** Set duty cycle percentage (0..100). */
  async setDutyCycle(channel: Channel, pct: number): Promise<void> {
    assertRange("duty cycle", pct, 0, 100);
    await this.setVerified(
      `set duty cycle ${pct} %`,
      () => this.sendWrite(chCode(channel, "D"), encodeDutyPct(pct)),
      () => this.getDutyCycle(channel),
      (got) => Math.abs(got - pct) <= 0.05,
    );
  }

  /** Read duty cycle percentage. */
  async getDutyCycle(channel: Channel): Promise<number> {
    const raw = await this.sendRead(chReadCode(channel, "D"));
    return decodeDutyPct(this.detectedFamily, raw);
  }

  /** Set phase in degrees (0..360). */
  async setPhase(channel: Channel, degrees: number): Promise<void> {
    assertRange("phase", degrees, 0, 360);
    const tolerance = this.tol(1, 0.005);
    await this.setVerified(
      `set phase ${degrees}°`,
      () => this.sendWrite(chCode(channel, "P"), encodePhaseDeg(this.detectedFamily, degrees)),
      () => this.getPhase(channel),
      // Wrap-aware: some firmware stores 360° as 0°.
      (got) => {
        const diff = Math.abs(got - degrees) % 360;
        return diff <= tolerance || Math.abs(diff - 360) <= tolerance;
      },
    );
  }

  /** Read phase in degrees. */
  async getPhase(channel: Channel): Promise<number> {
    const raw = await this.sendRead(chReadCode(channel, "P"));
    return decodePhaseDeg(this.detectedFamily, raw);
  }

  /** Enable or disable the channel output. */
  async setOutput(channel: Channel, enabled: boolean): Promise<void> {
    await this.setVerified(
      `set output ${enabled ? "on" : "off"}`,
      () => this.sendWrite(chCode(channel, "N"), enabled ? "1" : "0"),
      () => this.getOutput(channel),
      (got) => got === enabled,
    );
  }

  /** Read whether the channel output is enabled. */
  async getOutput(channel: Channel): Promise<boolean> {
    const raw = await this.sendRead(chReadCode(channel, "N"));
    return decodeBool(raw);
  }

  /** Set channel attenuation (FY2300 only — FY6900 does not have WMT). */
  async setAttenuation(channel: Channel, atten: Attenuation): Promise<void> {
    await this.sendWrite(chCode(channel, "T"), atten);
  }

  /** Set the pulse period in nanoseconds (FY6900 only, main channel). */
  async setPulsePeriodNs(ns: number): Promise<void> {
    await this.sendWrite("WMS", Math.round(ns).toString());
  }

  /** Read the pulse period in nanoseconds (FY6900 only, main channel). */
  async getPulsePeriodNs(): Promise<number> {
    const raw = await this.sendRead("RSS");
    return decodeInt(raw);
  }

  /** Read a snapshot of the channel's full state. */
  async getChannelState(channel: Channel): Promise<ChannelState> {
    const [waveform, frequencyHz, amplitudeV, offsetV, dutyCyclePct, phaseDeg, enabled] =
      await Promise.all([
        this.getWaveform(channel),
        this.getFrequency(channel),
        this.getAmplitude(channel),
        this.getOffset(channel),
        this.getDutyCycle(channel),
        this.getPhase(channel),
        this.getOutput(channel),
      ]);
    return {
      waveform,
      waveformName: waveformName(this.detectedFamily, channel, waveform),
      frequencyHz,
      amplitudeV,
      offsetV,
      dutyCyclePct,
      phaseDeg,
      enabled,
    };
  }

  /**
   * Convenience configuration of an entire channel in one call.
   * Skips parameters that are `undefined`.
   */
  async configureChannel(
    channel: Channel,
    cfg: Partial<{
      waveform: number | string;
      frequencyHz: number;
      amplitudeV: number;
      offsetV: number;
      dutyCyclePct: number;
      phaseDeg: number;
      enabled: boolean;
    }>,
  ): Promise<void> {
    if (cfg.waveform !== undefined) await this.setWaveform(channel, cfg.waveform);
    if (cfg.frequencyHz !== undefined) await this.setFrequency(channel, cfg.frequencyHz);
    if (cfg.amplitudeV !== undefined) await this.setAmplitude(channel, cfg.amplitudeV);
    if (cfg.offsetV !== undefined) await this.setOffset(channel, cfg.offsetV);
    if (cfg.dutyCyclePct !== undefined) await this.setDutyCycle(channel, cfg.dutyCyclePct);
    if (cfg.phaseDeg !== undefined) await this.setPhase(channel, cfg.phaseDeg);
    if (cfg.enabled !== undefined) await this.setOutput(channel, cfg.enabled);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Modulation (FY6900 family)
  // ──────────────────────────────────────────────────────────────────────────

  /** Set the main wave modulation mode. */
  async setModulationMode(mode: ModulationMode): Promise<void> {
    await this.setVerified(
      `set modulation mode ${mode}`,
      () => this.sendWrite("WPF", mode),
      () => this.getModulationMode(),
      (got) => got === mode,
    );
  }
  async getModulationMode(): Promise<ModulationMode> {
    return decodeInt(await this.sendRead("RPF")) as ModulationMode;
  }

  /** Set the modulation source. */
  async setModulationSource(source: ModulationSource): Promise<void> {
    await this.setVerified(
      `set modulation source ${source}`,
      () => this.sendWrite("WPM", source),
      () => this.getModulationSource(),
      (got) => got === source,
    );
  }
  async getModulationSource(): Promise<ModulationSource> {
    return decodeInt(await this.sendRead("RPM")) as ModulationSource;
  }

  /** Set burst pulse count (max 1048575). */
  async setBurstCount(count: number): Promise<void> {
    assertRange("burst count", count, 1, 1048575);
    await this.sendWrite("WPN", Math.round(count).toString());
  }
  async getBurstCount(): Promise<number> {
    return decodeInt(await this.sendRead("RPN"));
  }

  /** Fire a manual modulation trigger (FY6900). */
  async manualTrigger(): Promise<void> {
    await this.sendWrite("WPO");
  }

  /** FSK secondary frequency in Hz (FY6900). */
  async setFskFrequency(hz: number): Promise<void> {
    await this.sendWrite("WFK", hz.toFixed(1));
  }
  async getFskFrequency(): Promise<number> {
    return Number(await this.sendRead("RFK"));
  }

  /** AM modulation depth in percent (FY6900). */
  async setAmModulationRate(percent: number): Promise<void> {
    await this.sendWrite("WPR", percent.toFixed(1));
  }
  async getAmModulationRate(): Promise<number> {
    return Number(await this.sendRead("RPR"));
  }

  /** FM frequency deviation in Hz (FY6900). */
  async setFmDeviation(hz: number): Promise<void> {
    await this.sendWrite("WFM", hz.toFixed(1));
  }
  async getFmDeviation(): Promise<number> {
    return Number(await this.sendRead("RFM"));
  }

  /** PM phase offset in degrees (FY6900). */
  async setPmPhaseOffset(deg: number): Promise<void> {
    await this.sendWrite("WPP", deg.toFixed(2));
  }
  async getPmPhaseOffset(): Promise<number> {
    return Number(await this.sendRead("RPP"));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Arbitrary waveform upload
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Upload a custom arbitrary waveform to the device.
   *
   * @param slot    Arbitrary waveform slot (1-based). FY2300: 1-16, FY6900: 1-64.
   * @param values  Float values to upload. Automatically scaled to 14-bit.
   * @param options Optional: min/max for scaling, sample count, and the
   *                `resample`/`normalize` conveniences from waveform-utils.
   */
  async uploadWaveform(
    slot: number,
    values: number[],
    options: {
      minValue?: number;
      maxValue?: number;
      sampleCount?: number;
      /** Linearly resample `values` to `sampleCount` points first. */
      resample?: boolean;
      /** Scale `values` symmetrically into −1…+1 first. */
      normalize?: boolean;
    } = {},
  ): Promise<void> {
    const minValue = options.minValue ?? -1.0;
    const maxValue = options.maxValue ?? 1.0;
    const sampleCount = options.sampleCount ?? 8192;
    if (options.normalize) values = normalizeWaveform(values);
    if (options.resample && values.length !== sampleCount) {
      values = resampleWaveform(values, sampleCount);
    }

    const maxSlot =
      this.detectedFamily === "FY2300" ? FY2300_ARBITRARY_COUNT : FY6900_ARBITRARY_COUNT;
    if (!Number.isInteger(slot) || slot < 1 || slot > maxSlot) {
      throw new FeelTechError(
        `Waveform slot must be an integer 1..${maxSlot} (${this.detectedFamily}), got ${slot}`,
      );
    }

    if (values.length !== sampleCount) {
      throw new FeelTechError(
        `Expected ${sampleCount} values, got ${values.length}`,
      );
    }

    // Check that neither channel is using this arbitrary waveform.
    for (const ch of [Channel.Main, Channel.Aux]) {
      const currentWave = await this.getWaveformName(ch);
      const expectedName = `Arbitrary${slot}`;
      if (currentWave === expectedName) {
        throw new FeelTechError(
          `Cannot update ${expectedName} because it is active on channel ${ch === Channel.Main ? "CH1" : "CH2"}. Switch to a different waveform first.`,
        );
      }
    }

    // Convert float values to 14-bit raw integers (full scale maps to 16383).
    const rawValues = new Uint16Array(sampleCount);
    const range = maxValue - minValue;
    if (!(range > 0)) {
      throw new FeelTechError(`maxValue must be greater than minValue (got ${minValue}..${maxValue})`);
    }
    for (let i = 0; i < sampleCount; i++) {
      let v = Math.round(((values[i]! - minValue) / range) * 16383);
      if (v < 0) v = 0;
      if (v > 16383) v = 16383;
      rawValues[i] = v;
    }

    // Pack into bytes: low byte (8 bits) + high byte (upper 6 bits).
    const data = new Uint8Array(sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) {
      const v = rawValues[i]!;
      data[i * 2] = v & 0xff;
      data[i * 2 + 1] = (v >> 8) & 0x3f;
    }

    // Step 1-3: Send command and binary data under the command lock.
    await this.run(async () => {
      const cmd = `DDS_WAVE${slot}\n`;
      this.log(`>> ${JSON.stringify(cmd)}`);
      await this.transport.write(cmd);

      const ack = await this.readLineWithRetry(2000, 3);
      this.log(`<< DDS_WAVE ack: ${JSON.stringify(ack)}`);
      if (ack !== "W") {
        throw new FeelTechError(
          `DDS_WAVE command not acknowledged. Expected "W", got ${JSON.stringify(ack)}`,
        );
      }

      this.log(`>> [binary waveform data, ${data.length} bytes]`);
      await this.transport.write(data);
    });

    // Step 4: Wait for the device to finish processing, then verify it's responsive.
    // The FY6300 sends "HN" (without newline) very slowly; we just wait and flush.
    await this.delay(3000);
    await this.transport.flush();
    await this.delay(100);

    try {
      const probe = await this.sendRead("UMO");
      this.log(`<< Upload verified, device responsive: ${JSON.stringify(probe)}`);
    } catch (err) {
      throw new FeelTechError(
        `DDS_WAVE upload failed — device not responding after data transfer`,
        err,
      );
    }
  }

  /**
   * Read a line, retrying on empty responses.
   */
  private async readLineWithRetry(timeoutMs: number, maxRetries: number): Promise<string> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const line = await this.transport.readLine(timeoutMs);
        const cleaned = cleanResponse(line);
        if (cleaned.length > 0) return cleaned;
      } catch {
        // Empty or timeout — retry if attempts remain.
      }
    }
    return "";
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Frequency counter / measurement
  // ──────────────────────────────────────────────────────────────────────────

  async resetCounter(): Promise<void> {
    await this.sendWrite("WCZ", 0);
  }
  async pauseCounter(): Promise<void> {
    await this.sendWrite("WCP", 0);
  }
  async setGateTime(g: GateTime): Promise<void> {
    await this.sendWrite("WCG", g);
  }
  async getGateTime(): Promise<GateTime> {
    return decodeInt(await this.sendRead("RCG")) as GateTime;
  }
  async setMeasurementCoupling(c: CouplingMode): Promise<void> {
    await this.sendWrite("WCC", c);
  }

  /** Read the measured frequency, scaled by current gate time. */
  async readMeasuredFrequencyHz(): Promise<number> {
    const gate = await this.getGateTime();
    const raw = decodeInt(await this.sendRead("RCF"));
    // Gate 0 → divide by 1, 1 → divide by 10, 2 → divide by 100.
    return raw / Math.pow(10, gate);
  }

  async readPulseCount(): Promise<number> {
    return decodeInt(await this.sendRead("RCC"));
  }
  async readMeasuredPeriodNs(): Promise<number> {
    return decodeInt(await this.sendRead("RCT"));
  }
  async readPositivePulseNs(): Promise<number> {
    return decodeInt(await this.sendRead("RC+"));
  }
  async readNegativePulseNs(): Promise<number> {
    return decodeInt(await this.sendRead("RC-"));
  }
  async readMeasuredDutyPct(): Promise<number> {
    return decodeCounterDutyPct(await this.sendRead("RCD"));
  }

  /** Read all measurement values at once. */
  async readMeasurement(): Promise<MeasurementResult> {
    const gateTime = await this.getGateTime();
    const [rawFreq, count, periodNs, posNs, negNs, dutyRaw] = await Promise.all([
      this.sendRead("RCF").then(decodeInt),
      this.sendRead("RCC").then(decodeInt),
      this.sendRead("RCT").then(decodeInt),
      this.sendRead("RC+").then(decodeInt),
      this.sendRead("RC-").then(decodeInt),
      this.sendRead("RCD"),
    ]);
    return {
      frequencyHz: rawFreq / Math.pow(10, gateTime),
      count,
      periodNs,
      positivePulseNs: posNs,
      negativePulseNs: negNs,
      dutyCyclePct: decodeCounterDutyPct(dutyRaw),
      gateTime,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Sweep
  // ──────────────────────────────────────────────────────────────────────────

  async setSweepObject(o: SweepObject): Promise<void> {
    await this.sendWrite("SOB", o);
  }
  async setSweepStart(value: number, object: SweepObject): Promise<void> {
    await this.sendWrite("SST", this.formatSweepValue(value, object));
  }
  async setSweepEnd(value: number, object: SweepObject): Promise<void> {
    await this.sendWrite("SEN", this.formatSweepValue(value, object));
  }
  async setSweepTime(seconds: number): Promise<void> {
    await this.sendWrite("STI", seconds.toFixed(2));
  }
  async setSweepMode(m: SweepMode): Promise<void> {
    await this.sendWrite("SMO", m);
  }
  async setSweepSource(s: SweepSource): Promise<void> {
    await this.sendWrite("SXY", s);
  }
  async startSweep(): Promise<void> {
    await this.sendWrite("SBE", 1);
  }
  async stopSweep(): Promise<void> {
    await this.sendWrite("SBE", 0);
  }

  /** Configure a sweep in one call. Does not start it — call `startSweep()` after. */
  async configureSweep(cfg: SweepConfig): Promise<void> {
    await this.setSweepObject(cfg.object);
    await this.setSweepStart(cfg.start, cfg.object);
    await this.setSweepEnd(cfg.end, cfg.object);
    await this.setSweepTime(cfg.timeSeconds);
    await this.setSweepMode(cfg.mode);
    if (cfg.source !== undefined) await this.setSweepSource(cfg.source);
  }

  /**
   * Format a sweep start/end value for SST/SEN.
   *
   * FY6900-family firmware stores sweep offsets with a +10 V bias
   * (see docs/serial_protocol.md §10) — applied automatically here,
   * matching the fygen reference implementation.
   */
  private formatSweepValue(value: number, object: SweepObject): string {
    switch (object) {
      case SweepObject.Frequency:
        return value.toFixed(1); // Hz
      case SweepObject.Amplitude:
        return value.toFixed(3); // V
      case SweepObject.Offset: {
        const biased = this.detectedFamily === "FY2300" ? value : value + 10;
        return biased.toFixed(3); // V
      }
      case SweepObject.DutyCycle:
        return value.toFixed(1); // %
      default:
        return value.toString();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // System settings
  // ──────────────────────────────────────────────────────────────────────────

  /** Save current parameters to a numbered slot (1..99). */
  async saveState(slot: number): Promise<void> {
    assertRange("state slot", slot, 1, 99);
    await this.sendWrite("USN", Math.round(slot).toString().padStart(2, "0"));
  }
  /** Load parameters from a numbered slot (1..99). */
  async loadState(slot: number): Promise<void> {
    assertRange("state slot", slot, 1, 99);
    await this.sendWrite("ULN", Math.round(slot).toString().padStart(2, "0"));
  }
  async enableSync(o: SyncObject): Promise<void> {
    await this.sendWrite("USA", o);
  }
  async disableSync(o: SyncObject): Promise<void> {
    await this.sendWrite("USD", o);
  }
  async readSync(o: SyncObject): Promise<boolean> {
    return decodeBool(await this.sendRead("RSA" + o));
  }
  async setBuzzer(on: boolean): Promise<void> {
    await this.sendWrite("UBZ", on ? 1 : 0);
  }
  async getBuzzer(): Promise<boolean> {
    return decodeBool(await this.sendRead("RBZ"));
  }
  async setCascadeRole(role: CascadeRole): Promise<void> {
    await this.sendWrite("UMS", role);
  }
  async getCascadeRole(): Promise<CascadeRole> {
    return decodeInt(await this.sendRead("RMS")) as CascadeRole;
  }
  async setUplink(on: boolean): Promise<void> {
    await this.sendWrite(this.detectedFamily === "FY2300" ? "UML" : "UUL", on ? 1 : 0);
  }
  async getUplink(): Promise<boolean> {
    return decodeBool(await this.sendRead("RUL"));
  }

  /** Read the device ID. */
  async readId(): Promise<string> {
    return this.sendRead("UID");
  }
  /** Read the device model string. */
  async readModel(): Promise<string> {
    return this.sendRead("UMO");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Discovery helpers
  // ──────────────────────────────────────────────────────────────────────────

  /** List all waveforms known to the configured family for the given channel. */
  listWaveforms(channel: Channel): WaveformDescriptor[] {
    assertChannel(channel);
    return listWaveformsFor(this.detectedFamily, channel);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal
  // ──────────────────────────────────────────────────────────────────────────

  private guessFamily(model: string): DeviceFamily {
    if (!model) return "Unknown";
    const m = model.toUpperCase();
    if (m.includes("FY23") || m.includes("FY2300") || m.includes("FY2350")) return "FY2300";
    if (m.includes("FY63") || m.includes("FY66") || m.includes("FY68") || m.includes("FY69") || m.includes("FY83")) {
      return "FY6900";
    }
    return "Unknown";
  }

  private log(message: string, ...rest: unknown[]): void {
    if (this.opts.debug) this.opts.logger(message, ...rest);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Serializes commands so two `await` callers don't interleave bytes on the wire.
   */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.commandLock.then(fn, fn);
    // Swallow rejection on the lock chain so a single error doesn't poison subsequent calls.
    this.commandLock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

/** Re-export the Channel enum for convenience at the top level. */
export { Channel };

/** Throw a typed error if the configuration is wrong. */
export function assertFamily(
  device: FeelTech,
  ...allowed: DeviceFamily[]
): void {
  if (!allowed.includes(device.family)) {
    throw new FeelTechError(
      `This operation requires one of [${allowed.join(", ")}], but device is ${device.family}`,
    );
  }
}
