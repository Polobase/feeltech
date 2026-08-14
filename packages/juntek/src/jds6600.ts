/**
 * JUNTEK JDS6600 driver — also covers the JDS2800, JDS2900, JDS8000 and the
 * Koolertron-badged CJDS66.
 *
 * Those are one driver because they are one protocol. Koolertron is a reseller
 * brand rather than a manufacturer: the CJDS66 is a rebadged JDS6600 and speaks
 * the same register set. The model name only changes the label reported in
 * {@link DeviceInfo}.
 *
 * Wire format: 115200 8N1, `:w<register>=<value>.` terminated with CRLF,
 * answered `:ok`.
 *
 * **Verification status: unverified.** Implemented from the JDS6600 protocol as
 * described by `on1arf/jds6600_python` and the Joy-IT protocol manual; not
 * checked against hardware here. The JDS8000 in particular is reported to use
 * this protocol but is the least corroborated of the set.
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
 * Register map.
 *
 * Per-channel registers take the channel index added to the base, so CH1
 * frequency is 23 and CH2 frequency is 24. Register 20 is the exception: it
 * carries **both** channels' output states in one write, which is why the
 * driver has to remember them.
 */
export const JDS_REGISTERS = {
  /** Both channels at once: `:w20=<ch1>,<ch2>.` */
  output: 20,
  waveform: 21,
  frequency: 23,
  amplitude: 25,
  offset: 27,
  duty: 29,
  /** Single register, not per-channel. */
  phase: 31,
} as const;

/**
 * Waveform slots.
 *
 * ⚠ Slot 3 is a **triangle**, not a sawtooth. A `ramp-up` request therefore
 * comes back `substituted: true` — it will not be the asymmetric shape the
 * Spooky2 contact shells expect.
 */
const JDS_WAVEFORM_SLOTS: Readonly<Partial<Record<WaveformKind, number>>> = {
  sine: 0,
  square: 1,
  triangle: 3,
};

const JDS_WAVEFORMS: readonly WaveformKind[] = ["sine", "square", "triangle"];

/** Models known to speak this protocol. */
export type JdsModel = "JDS6600" | "JDS2800" | "JDS2900" | "JDS8000" | "CJDS66";

export interface Jds6600Options {
  /** Which model to report in `info`. Default: `"JDS6600"`. */
  model?: JdsModel;
  /** Pause between commands in ms. Default: 20. */
  commandDelayMs?: number;
  /** How long to wait for `:ok`. Default: 300 ms. */
  ackTimeoutMs?: number;
  /** Throw when an acknowledgement does not arrive. Default: false. */
  strictAck?: boolean;
  debug?: boolean;
  logger?: (message: string, ...args: unknown[]) => void;
}

export class Jds6600 implements SignalGenerator {
  readonly info: DeviceInfo;

  private commandLock = Promise.resolve();
  /** Register 20 writes both channels, so both states must be tracked. */
  private outputs: [0 | 1, 0 | 1] = [0, 0];
  private opts: Required<Omit<Jds6600Options, "logger" | "model">> & {
    logger: (message: string, ...args: unknown[]) => void;
  };

  constructor(
    public readonly transport: Transport,
    options: Jds6600Options = {},
  ) {
    const model = options.model ?? "JDS6600";
    this.info = {
      // Koolertron resells JUNTEK hardware; the CJDS66 is a rebadged JDS6600.
      vendor: model === "CJDS66" ? "Koolertron" : "JUNTEK",
      model,
    };
    this.opts = {
      commandDelayMs: options.commandDelayMs ?? 20,
      ackTimeoutMs: options.ackTimeoutMs ?? 300,
      strictAck: options.strictAck ?? false,
      debug: options.debug ?? false,
      logger:
        options.logger ??
        ((msg: string, ...rest: unknown[]) => console.log("[jds6600]", msg, ...rest)),
    };
  }

  get capabilities(): Capabilities {
    return {
      ...DEFAULT_CAPABILITIES,
      channels: 2,
      waveforms: JDS_WAVEFORMS,
      limits: unknownLimits(
        false,
        `No frequency limits established for the ${this.info.model}. The JDS6600 ` +
          "ships in 15/25/40/60 MHz variants under one model name, so a single " +
          "figure would be wrong for most units.",
        ["on1arf/jds6600_python", "Joy-IT JDS6600 protocol manual"],
      ),
    };
  }

  async open(): Promise<void> {
    await this.transport.open({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
  }

  async close(): Promise<void> {
    try {
      this.outputs = [0, 0];
      await this.write(JDS_REGISTERS.output, "0,0");
    } catch {
      /* closing anyway */
    }
    await this.transport.close();
  }

  async setWaveform(
    channel: number,
    waveform: WaveformKind | number,
  ): Promise<AppliedWaveform> {
    assertChannel(channel);
    if (typeof waveform === "number") {
      await this.write(JDS_REGISTERS.waveform + channel, waveform);
      const kind = (Object.keys(JDS_WAVEFORM_SLOTS) as WaveformKind[]).find(
        (k) => JDS_WAVEFORM_SLOTS[k] === waveform,
      );
      return {
        requested: kind ?? "custom",
        actual: kind ?? "custom",
        substituted: false,
        code: waveform,
      };
    }

    const direct = JDS_WAVEFORM_SLOTS[waveform];
    const actual =
      direct !== undefined ? waveform : substituteWaveform(waveform, JDS_WAVEFORMS);
    if (actual === undefined) {
      throw new AwgError(
        `The ${this.info.model} has no mapped waveform that can stand in for "${waveform}"`,
      );
    }
    const code = JDS_WAVEFORM_SLOTS[actual]!;
    await this.write(JDS_REGISTERS.waveform + channel, code);
    return { requested: waveform, actual, substituted: direct === undefined, code };
  }

  /**
   * Set the frequency.
   *
   * The value is centihertz and the second field is a unit code, where `0`
   * means hertz. The driver always uses the hertz code — the others exist to
   * extend range at the cost of resolution, and centihertz already covers the
   * full span at full precision.
   */
  async setFrequency(channel: number, hz: number): Promise<void> {
    assertChannel(channel);
    assertFinite("frequency", hz);
    if (hz < 0) throw new AwgError(`frequency must be >= 0 Hz, got ${hz}`);
    await this.write(
      JDS_REGISTERS.frequency + channel,
      `${Math.round(Math.max(0, hz) * 100)},0`,
    );
  }

  /** Set the peak-to-peak amplitude. The register takes millivolts. */
  async setAmplitude(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertFinite("amplitude", volts);
    if (volts < 0) throw new AwgError(`amplitude must be >= 0 V, got ${volts}`);
    await this.write(JDS_REGISTERS.amplitude + channel, Math.round(volts * 1000));
  }

  /**
   * Set the DC offset.
   *
   * The register takes 10 mV units biased by 1000, so `1000` is 0 V and each
   * count is 10 mV either side.
   */
  async setOffset(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertFinite("offset", volts);
    await this.write(JDS_REGISTERS.offset + channel, Math.round(volts * 100) + 1000);
  }

  /** Set the duty cycle in percent, at 0.1 % resolution. */
  async setDutyCycle(channel: number, pct: number): Promise<void> {
    assertChannel(channel);
    assertRange("duty cycle", pct, 0, 100);
    await this.write(JDS_REGISTERS.duty + channel, Math.round(pct * 10));
  }

  /**
   * Set the phase in degrees, at 0.1° resolution.
   *
   * There is one phase register for the instrument — it expresses CH2's offset
   * relative to CH1 — so this ignores the channel argument.
   */
  async setPhase(_channel: number, degrees: number): Promise<void> {
    assertFinite("phase", degrees);
    const normalised = ((degrees % 360) + 360) % 360;
    await this.write(JDS_REGISTERS.phase, Math.round(normalised * 10));
  }

  /**
   * Switch a channel's output.
   *
   * Register 20 carries both channels in one write, so the other channel's
   * state is re-sent from the driver's own record. Nothing else may change it
   * behind our back for this to stay correct — which is why `close()` resets it.
   */
  async setOutput(channel: number, enabled: boolean): Promise<void> {
    assertChannel(channel);
    this.outputs[channel] = enabled ? 1 : 0;
    await this.write(JDS_REGISTERS.output, `${this.outputs[0]},${this.outputs[1]}`);
  }

  async applyStep(channel: number, step: ChannelStep): Promise<void> {
    await applyStepSequentially(this, channel, step);
  }

  /** Send a raw command line (the `.` terminator and CRLF are added). */
  async raw(command: string): Promise<void> {
    await this.run(async () => {
      this.log(`>> ${command}`);
      await this.transport.write(command + "\r\n");
      await this.expectAck(command);
    });
  }

  private async write(register: number, value: number | string): Promise<void> {
    const command = `:w${register}=${value}.`;
    await this.run(async () => {
      this.log(`>> ${command}`);
      await this.transport.write(command + "\r\n");
      await this.expectAck(command);
      if (this.opts.commandDelayMs > 0) await delay(this.opts.commandDelayMs);
    });
  }

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
    throw new AwgError(`Invalid channel ${channel} — this device has channels 0 and 1`);
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
