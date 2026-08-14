/**
 * Spooky2 XM driver.
 *
 * Wire format: 57600 8N1, commands of the form `:w<reg><value>\r\n`, each
 * answered with `ok`. Registers are addressed per channel by adding the channel
 * index to a base code, so CH1 frequency is register 23 and CH2 frequency is 24.
 *
 * Protocol source: the `calum74/s2` reimplementation of the Spooky2 generator
 * link (`Generator.cpp`). **Not verified against hardware here** — see
 * `capabilities.limits.verified`. The wire-transcript tests assert conformance
 * to that description, which is the strongest claim available without an XM on
 * the bench.
 */

import {
  AwgError,
  DEFAULT_CAPABILITIES,
  applyStepSequentially,
  substituteWaveform,
  unknownLimits,
  type AppliedWaveform,
  type Capabilities,
  type ChannelStep,
  type DeviceInfo,
  type SignalGenerator,
  type Transport,
  type WaveformKind,
} from "@freqgen/core";

/**
 * Register base codes. The channel index is *added* to the base, so these are
 * CH1's numbers and CH2 uses base + 1.
 */
export const XM_REGISTERS = {
  waveform: 21,
  frequency: 23,
  amplitude: 25,
  offset: 27,
  duty: 29,
  phase: 31,
  relay: 61,
  frequencyScale: 63,
  /** Not per-channel: makes CH2 track CH1's frequency in hardware. */
  sync: 68,
} as const;

/**
 * Below this the XM switches to a finer frequency encoding.
 *
 * The register is a plain integer, so the firmware trades range for resolution:
 * above the boundary a count is 10 mHz, below it a count is 10 µHz. The scale
 * register says which reading applies.
 */
export const XM_RANGE_BOUNDARY_HZ = 600;

/**
 * Waveform slots.
 *
 * Only sine (0) and square (1) are corroborated. Slot 2 is a sawtooth, but
 * which direction is not established, so it is claimed as `ramp-up` and the
 * opposite ramp substitutes onto it rather than being silently treated as
 * exact. Slot 3 is the user-defined waveform.
 */
const XM_WAVEFORM_SLOTS: Readonly<Partial<Record<WaveformKind, number>>> = {
  sine: 0,
  square: 1,
  "ramp-up": 2,
  custom: 3,
};

const XM_WAVEFORMS: readonly WaveformKind[] = Object.keys(
  XM_WAVEFORM_SLOTS,
) as WaveformKind[];

export interface Spooky2XmOptions {
  /** How long to wait for the `ok` acknowledgement. Default: 500 ms. */
  ackTimeoutMs?: number;
  /**
   * Throw when an acknowledgement does not arrive, instead of warning and
   * carrying on. Default: false — real units occasionally skip the ack, and
   * failing the whole run over it is worse than proceeding.
   */
  strictAck?: boolean;
  /** Pause between commands in ms. Default: 0. */
  commandDelayMs?: number;
  /** Assumed peak-to-peak amplitude before one is set, for offset conversion. */
  initialAmplitudeVpp?: number;
  debug?: boolean;
  logger?: (message: string, ...args: unknown[]) => void;
}

export class Spooky2XM implements SignalGenerator {
  readonly info: DeviceInfo = { vendor: "Spooky2", model: "XM" };

  private opts: Required<
    Omit<Spooky2XmOptions, "logger">
  > & { logger: (message: string, ...args: unknown[]) => void };

  private commandLock = Promise.resolve();
  /** Last frequency scale written per channel; null until the first write. */
  private scale: Array<"high" | "low" | null> = [null, null];
  /** Last amplitude per channel — the XM states offset as a fraction of it. */
  private amplitude: number[];

  constructor(
    public readonly transport: Transport,
    options: Spooky2XmOptions = {},
  ) {
    const initialAmplitudeVpp = options.initialAmplitudeVpp ?? 10;
    this.opts = {
      ackTimeoutMs: options.ackTimeoutMs ?? 500,
      strictAck: options.strictAck ?? false,
      commandDelayMs: options.commandDelayMs ?? 0,
      initialAmplitudeVpp,
      debug: options.debug ?? false,
      logger:
        options.logger ??
        ((msg: string, ...rest: unknown[]) => console.log("[spooky2-xm]", msg, ...rest)),
    };
    this.amplitude = [initialAmplitudeVpp, initialAmplitudeVpp];
  }

  get capabilities(): Capabilities {
    return {
      ...DEFAULT_CAPABILITIES,
      channels: 2,
      // Register 68 slaves CH2's frequency to CH1 inside the device.
      hardwareSync: true,
      waveforms: XM_WAVEFORMS,
      limits: unknownLimits(
        false,
        "No frequency limits established. The XM is widely described as a 5 MHz " +
          "unit reaching 25 MHz with a wave-cycle multiplier, but neither figure " +
          "has been confirmed here, so both are left unknown.",
        ["calum74/s2 Generator.cpp"],
      ),
    };
  }

  async open(): Promise<void> {
    await this.transport.open({
      baudRate: 57600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Parameters
  // ────────────────────────────────────────────────────────────────────────

  async setWaveform(
    channel: number,
    waveform: WaveformKind | number,
  ): Promise<AppliedWaveform> {
    assertChannel(channel);
    if (typeof waveform === "number") {
      await this.send(XM_REGISTERS.waveform + channel, waveform);
      const kind = (Object.keys(XM_WAVEFORM_SLOTS) as WaveformKind[]).find(
        (k) => XM_WAVEFORM_SLOTS[k] === waveform,
      );
      return {
        requested: kind ?? "custom",
        actual: kind ?? "custom",
        substituted: false,
        code: waveform,
      };
    }

    const direct = XM_WAVEFORM_SLOTS[waveform];
    if (direct !== undefined) {
      await this.send(XM_REGISTERS.waveform + channel, direct);
      return { requested: waveform, actual: waveform, substituted: false, code: direct };
    }

    const actual = substituteWaveform(waveform, XM_WAVEFORMS);
    if (actual === undefined) {
      throw new AwgError(`The XM has no waveform that can stand in for "${waveform}"`);
    }
    const code = XM_WAVEFORM_SLOTS[actual]!;
    await this.send(XM_REGISTERS.waveform + channel, code);
    return { requested: waveform, actual, substituted: true, code };
  }

  /**
   * Set the output frequency.
   *
   * Switches the channel's scale register when crossing
   * {@link XM_RANGE_BOUNDARY_HZ}, and only then — rewriting an unchanged scale
   * on every step would double the traffic during a frequency run.
   */
  async setFrequency(channel: number, hz: number): Promise<void> {
    assertChannel(channel);
    assertFinite("frequency", hz);
    if (hz < 0) throw new AwgError(`frequency must be >= 0 Hz, got ${hz}`);

    const want = hz < XM_RANGE_BOUNDARY_HZ ? "low" : "high";
    if (this.scale[channel] !== want) {
      await this.send(XM_REGISTERS.frequencyScale + channel, want === "high" ? 0 : 1);
      this.scale[channel] = want;
    }
    const counts = want === "high" ? Math.round(hz * 100) : Math.round(hz * 100_000);
    await this.send(XM_REGISTERS.frequency + channel, counts);
  }

  /** Set peak-to-peak amplitude in volts. */
  async setAmplitude(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertFinite("amplitude", volts);
    if (volts < 0) throw new AwgError(`amplitude must be >= 0 V, got ${volts}`);
    this.amplitude[channel] = volts;
    await this.send(XM_REGISTERS.amplitude + channel, Math.round(volts * 100));
  }

  /**
   * Set the DC offset in volts.
   *
   * The XM states offset as a fraction of the amplitude, not as an absolute
   * voltage, so this converts using the last amplitude written to the channel
   * (or `initialAmplitudeVpp` if none). Set amplitude first when both change —
   * or use {@link setOffsetRatio}, which is the device's own unit and the one
   * Spooky2 presets are written in.
   */
  async setOffset(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertFinite("offset", volts);
    const halfAmplitude = (this.amplitude[channel] ?? this.opts.initialAmplitudeVpp) / 2;
    if (halfAmplitude <= 0) {
      throw new AwgError(
        "Cannot express an offset in volts while the amplitude is 0 — " +
          "set an amplitude first, or use setOffsetRatio()",
      );
    }
    await this.setOffsetRatio(channel, volts / halfAmplitude);
  }

  /**
   * Set the DC offset as a fraction of amplitude, −1…+1.
   *
   * This is the device's native unit: `+1` is Spooky2's "100 % offset", the
   * fully-positive waveform its plasma and coil shells call for.
   */
  async setOffsetRatio(channel: number, ratio: number): Promise<void> {
    assertChannel(channel);
    assertFinite("offset ratio", ratio);
    const clamped = Math.max(-1, Math.min(1, ratio));
    await this.send(XM_REGISTERS.offset + channel, 100 + Math.round(clamped * 100));
  }

  /** Set the duty cycle in percent (0–100), at 0.1 % resolution. */
  async setDutyCycle(channel: number, pct: number): Promise<void> {
    assertChannel(channel);
    assertRange("duty cycle", pct, 0, 100);
    await this.send(XM_REGISTERS.duty + channel, Math.round(pct * 10));
  }

  /** Set the phase in degrees. */
  async setPhase(channel: number, degrees: number): Promise<void> {
    assertChannel(channel);
    assertFinite("phase", degrees);
    const normalised = ((degrees % 360) + 360) % 360;
    await this.send(XM_REGISTERS.phase + channel, Math.round(normalised));
  }

  /** Switch the channel's output relay. */
  async setOutput(channel: number, enabled: boolean): Promise<void> {
    assertChannel(channel);
    await this.send(XM_REGISTERS.relay + channel, enabled ? 1 : 0);
  }

  /** Slave CH2's frequency to CH1 in hardware. */
  async setSync(enabled: boolean): Promise<void> {
    await this.send(XM_REGISTERS.sync, enabled ? 1 : 0);
  }

  async applyStep(channel: number, step: ChannelStep): Promise<void> {
    await applyStepSequentially(this, channel, step);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Wire
  // ────────────────────────────────────────────────────────────────────────

  /** Send a raw command line (the `\r\n` terminator is added). */
  async raw(command: string): Promise<void> {
    await this.run(async () => {
      await this.transport.write(command + "\r\n");
      await this.expectAck(command);
    });
  }

  private async send(register: number, value: number): Promise<void> {
    const command = `:w${String(register).padStart(2, "0")}${value}`;
    await this.run(async () => {
      this.log(`>> ${command}`);
      await this.transport.write(command + "\r\n");
      await this.expectAck(command);
      if (this.opts.commandDelayMs > 0) await delay(this.opts.commandDelayMs);
    });
  }

  /**
   * Consume the `ok` acknowledgement.
   *
   * Lenient by default: a missing ack is logged, not thrown. Units in the field
   * skip it often enough that aborting a frequency run over one dropped reply
   * does more harm than carrying on. Pass `strictAck` to reverse that.
   */
  private async expectAck(command: string): Promise<void> {
    try {
      const line = (await this.transport.readLine(this.opts.ackTimeoutMs)).trim();
      if (line.length > 0 && !/^:?ok$/i.test(line)) {
        this.log(`!! unexpected reply to ${command}: ${JSON.stringify(line)}`);
      }
    } catch (err) {
      if (this.opts.strictAck) {
        throw new AwgError(`No acknowledgement for ${command}`, err);
      }
      this.log(`!! no acknowledgement for ${command} — continuing`);
    }
  }

  private log(message: string, ...rest: unknown[]): void {
    if (this.opts.debug) this.opts.logger(message, ...rest);
  }

  /** Serialize commands so two callers never interleave bytes on the wire. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.commandLock.then(fn, fn);
    this.commandLock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function assertChannel(channel: number): void {
  if (channel !== 0 && channel !== 1) {
    throw new AwgError(`Invalid channel ${channel} — the XM has channels 0 and 1`);
  }
}

function assertFinite(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AwgError(`${name} must be a finite number, got ${value}`);
  }
}

function assertRange(name: string, value: number, min: number, max: number): void {
  assertFinite(name, value);
  if (value < min || value > max) {
    throw new AwgError(`${name} must be between ${min} and ${max}, got ${value}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
