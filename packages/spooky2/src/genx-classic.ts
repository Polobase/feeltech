/**
 * Spooky2 Gen X (classic, non-Pro) driver.
 *
 * **Verification status: unverified and experimental.** The register map comes
 * from third-party notes on the non-Pro unit, and the audio/RF range boundary in
 * particular is a guess — see {@link GenXClassicOptions.audioMaxHz}. Confirm
 * with a scope before relying on any of it.
 *
 * Unlike the Pro, the classic unit is understood to have no authentication
 * gate, so ordinary register writes are expected to reach the outputs.
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

import { amplitudeRegisterValue, channelSlot } from "./genx-wire.js";

export const GENX_CLASSIC_REGISTERS = {
  output: 11,
  frequencyRange: 15,
  waveform: 21,
  frequency: 24,
  amplitude: 25,
} as const;

/**
 * Waveform slots.
 *
 * Only two are established: 11 is sine and 12 is square. Everything else the
 * generic vocabulary offers has to substitute onto one of them, which is why a
 * sawtooth request comes back as a sine with `substituted: true`.
 */
const GENX_WAVEFORM_SLOTS: Readonly<Partial<Record<WaveformKind, number>>> = {
  sine: 11,
  square: 12,
};

const GENX_WAVEFORMS: readonly WaveformKind[] = ["sine", "square"];

export interface GenXClassicOptions {
  /**
   * Frequency at which the unit switches from the audio scale to the RF scale.
   *
   * Default 1 MHz, and **this is a guess** — the real boundary has not been
   * established. It is exposed so you can correct it once you have measured
   * your unit rather than having to patch the driver.
   */
  audioMaxHz?: number;
  /** Pause between commands in ms. Default: 0. */
  commandDelayMs?: number;
  debug?: boolean;
  logger?: (message: string, ...args: unknown[]) => void;
}

export class GenXClassic implements SignalGenerator {
  readonly info: DeviceInfo = { vendor: "Spooky2", model: "Gen X (classic)" };

  private commandLock = Promise.resolve();
  private range: Array<0 | 1 | null> = [null, null];
  private opts: Required<Omit<GenXClassicOptions, "logger">> & {
    logger: (message: string, ...args: unknown[]) => void;
  };

  constructor(
    public readonly transport: Transport,
    options: GenXClassicOptions = {},
  ) {
    this.opts = {
      audioMaxHz: options.audioMaxHz ?? 1e6,
      commandDelayMs: options.commandDelayMs ?? 0,
      debug: options.debug ?? false,
      logger:
        options.logger ??
        ((msg: string, ...rest: unknown[]) =>
          console.log("[spooky2-genx-classic]", msg, ...rest)),
    };
  }

  get capabilities(): Capabilities {
    return {
      ...DEFAULT_CAPABILITIES,
      channels: 2,
      waveforms: GENX_WAVEFORMS,
      limits: unknownLimits(
        false,
        "No frequency limits established for the classic Gen X. The audio/RF " +
          "range boundary the driver uses is a default, not a measurement.",
        ["third-party non-Pro register notes"],
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
    await this.transport.close();
  }

  async setWaveform(
    channel: number,
    waveform: WaveformKind | number,
  ): Promise<AppliedWaveform> {
    assertChannel(channel);
    if (typeof waveform === "number") {
      await this.write(GENX_CLASSIC_REGISTERS.waveform + channel, channel, waveform);
      const kind = (Object.keys(GENX_WAVEFORM_SLOTS) as WaveformKind[]).find(
        (k) => GENX_WAVEFORM_SLOTS[k] === waveform,
      );
      return {
        requested: kind ?? "custom",
        actual: kind ?? "custom",
        substituted: false,
        code: waveform,
      };
    }

    const direct = GENX_WAVEFORM_SLOTS[waveform];
    if (direct !== undefined) {
      await this.write(GENX_CLASSIC_REGISTERS.waveform + channel, channel, direct);
      return { requested: waveform, actual: waveform, substituted: false, code: direct };
    }

    const actual = substituteWaveform(waveform, GENX_WAVEFORMS);
    if (actual === undefined) {
      throw new AwgError(
        `The Gen X has only sine and square slots; nothing can stand in for "${waveform}"`,
      );
    }
    const code = GENX_WAVEFORM_SLOTS[actual]!;
    await this.write(GENX_CLASSIC_REGISTERS.waveform + channel, channel, code);
    return { requested: waveform, actual, substituted: true, code };
  }

  /**
   * Set the output frequency, switching the audio/RF scale as needed.
   *
   * Below {@link GenXClassicOptions.audioMaxHz} a count is 10 µHz; at or above
   * it a count is 10 mHz. The range register is written only on a transition.
   */
  async setFrequency(channel: number, hz: number): Promise<void> {
    assertChannel(channel);
    assertFinite("frequency", hz);
    if (hz < 0) throw new AwgError(`frequency must be >= 0 Hz, got ${hz}`);

    const audio = hz < this.opts.audioMaxHz;
    const range: 0 | 1 = audio ? 0 : 1;
    if (this.range[channel] !== range) {
      await this.write(GENX_CLASSIC_REGISTERS.frequencyRange, channel, range);
      this.range[channel] = range;
    }
    const counts = audio ? Math.round(hz * 1e5) : Math.round(hz * 1e2);
    await this.write(GENX_CLASSIC_REGISTERS.frequency, channel, counts);
  }

  async setAmplitude(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertFinite("amplitude", volts);
    if (volts < 0) throw new AwgError(`amplitude must be >= 0 V, got ${volts}`);
    await this.write(
      GENX_CLASSIC_REGISTERS.amplitude,
      channel,
      amplitudeRegisterValue(volts),
    );
  }

  async setOutput(channel: number, enabled: boolean): Promise<void> {
    assertChannel(channel);
    await this.write(GENX_CLASSIC_REGISTERS.output, channel, enabled ? 1 : 0);
  }

  /** Not available: no offset register has been identified on the classic unit. */
  async setOffset(_channel: number, volts: number): Promise<void> {
    if (volts === 0) return;
    throw new AwgError(
      "No DC offset register is known for the classic Gen X — only an offset of 0 V " +
        "can be honoured. Requesting anything else would silently do nothing.",
    );
  }

  /** Not available: no duty register has been identified on the classic unit. */
  async setDutyCycle(_channel: number, pct: number): Promise<void> {
    if (pct === 50) return;
    throw new AwgError(
      `No duty-cycle register is known for the classic Gen X, so ${pct}% cannot be ` +
        "set. Only the default 50% is accepted.",
    );
  }

  /** Not available: no phase register has been identified on the classic unit. */
  async setPhase(_channel: number, degrees: number): Promise<void> {
    if (degrees === 0) return;
    throw new AwgError(
      `No phase register is known for the classic Gen X, so ${degrees}° cannot be set.`,
    );
  }

  async applyStep(channel: number, step: ChannelStep): Promise<void> {
    await applyStepSequentially(this, channel, step);
  }

  private async write(
    register: number,
    channel: number,
    value: number,
  ): Promise<void> {
    const command = `:w${String(register).padStart(2, "0")}=${channelSlot(channel, value)}`;
    await this.run(async () => {
      this.log(`>> ${command}`);
      await this.transport.write(command + "\r\n");
      if (this.opts.commandDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.opts.commandDelayMs));
      }
    });
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
    throw new AwgError(`Invalid channel ${channel} — the Gen X has channels 0 and 1`);
  }
}

function assertFinite(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AwgError(`${name} must be a finite number, got ${value}`);
  }
}
