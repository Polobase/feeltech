/**
 * FeelTech FY3200S / FY3224S driver — the older FY dialect.
 *
 * This shares a manufacturer with {@link FeelTech} and nothing else. Where the
 * FY6900 family speaks `WMF00001000.000000` at 115200 8N2, the FY32xx speaks
 * `bf100000` at 9600 8N1: lowercase single-letter commands, a `b`/`d` channel
 * prefix instead of `WM`/`WF`, centihertz instead of decimal hertz, and no
 * output relay at all.
 *
 * That last point is the one that changes behaviour rather than just encoding:
 * there is no command to switch an output on or off, so {@link FY3200S.setOutput}
 * emulates it by writing the amplitude — 0 V for off, the stored amplitude for
 * on. Amplitude writes while the output is "off" are remembered rather than
 * sent, so turning the channel on does not resurrect a stale level.
 *
 * **Verification status: unverified.** Implemented from the protocol as
 * described by the `sds1004x_bode` AWG driver collection; not checked against
 * hardware here.
 */

import {
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

import { FeelTechError } from "./types.js";

/**
 * Waveform slots.
 *
 * Slots 0 (sine) and 1 (square) are established. Slot 3 is a rising ramp. The
 * remaining slots exist — the command accepts 0–99 — but are not mapped here
 * because their shapes are not documented.
 */
const FY3200_WAVEFORM_SLOTS: Readonly<Partial<Record<WaveformKind, number>>> = {
  sine: 0,
  square: 1,
  "ramp-up": 3,
};

const FY3200_WAVEFORMS: readonly WaveformKind[] = ["sine", "square", "ramp-up"];

export interface FY3200SOptions {
  /**
   * Pause between commands in ms. Default: 30.
   *
   * The firmware needs a gap between commands; sending back to back loses them.
   */
  commandDelayMs?: number;
  /** Amplitude assumed before one is set, used for offset conversion. Default: 10 V. */
  initialAmplitudeVpp?: number;
  debug?: boolean;
  logger?: (message: string, ...args: unknown[]) => void;
}

export class FY3200S implements SignalGenerator {
  readonly info: DeviceInfo = { vendor: "FeelTech", model: "FY3200S" };

  private commandLock = Promise.resolve();
  private amplitude: number[];
  private outputOn = [false, false];
  private opts: Required<Omit<FY3200SOptions, "logger">> & {
    logger: (message: string, ...args: unknown[]) => void;
  };

  constructor(
    public readonly transport: Transport,
    options: FY3200SOptions = {},
  ) {
    const initialAmplitudeVpp = options.initialAmplitudeVpp ?? 10;
    this.opts = {
      commandDelayMs: options.commandDelayMs ?? 30,
      initialAmplitudeVpp,
      debug: options.debug ?? false,
      logger:
        options.logger ??
        ((msg: string, ...rest: unknown[]) => console.log("[fy3200s]", msg, ...rest)),
    };
    this.amplitude = [initialAmplitudeVpp, initialAmplitudeVpp];
  }

  get capabilities(): Capabilities {
    return {
      ...DEFAULT_CAPABILITIES,
      channels: 2,
      // No output relay: setOutput() gates via amplitude instead.
      outputRelay: false,
      waveforms: FY3200_WAVEFORMS,
      limits: unknownLimits(
        false,
        "No frequency limits established for the FY32xx series.",
        ["sds1004x_bode awgdrivers/fy3200s.py"],
      ),
    };
  }

  async open(): Promise<void> {
    await this.transport.open({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
    // The UART needs a moment after opening or the first command is dropped.
    await delay(200);
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
      assertSlot(waveform);
      await this.send(channel, `w${waveform}`);
      const kind = (Object.keys(FY3200_WAVEFORM_SLOTS) as WaveformKind[]).find(
        (k) => FY3200_WAVEFORM_SLOTS[k] === waveform,
      );
      return {
        requested: kind ?? "custom",
        actual: kind ?? "custom",
        substituted: false,
        code: waveform,
      };
    }

    const direct = FY3200_WAVEFORM_SLOTS[waveform];
    const actual =
      direct !== undefined ? waveform : substituteWaveform(waveform, FY3200_WAVEFORMS);
    if (actual === undefined) {
      throw new FeelTechError(
        `The FY3200S has no mapped waveform that can stand in for "${waveform}"`,
      );
    }
    const code = FY3200_WAVEFORM_SLOTS[actual]!;
    await this.send(channel, `w${code}`);
    return { requested: waveform, actual, substituted: direct === undefined, code };
  }

  /** Set the frequency. The FY32xx takes centihertz. */
  async setFrequency(channel: number, hz: number): Promise<void> {
    assertChannel(channel);
    assertFinite("frequency", hz);
    if (hz < 0) throw new FeelTechError(`frequency must be >= 0 Hz, got ${hz}`);
    await this.send(channel, `f${Math.round(Math.max(0, hz) * 100)}`);
  }

  /**
   * Set the peak-to-peak amplitude.
   *
   * While the channel is "off" the value is only remembered — writing it would
   * be indistinguishable from switching the output back on, since amplitude is
   * how this device gates output.
   */
  async setAmplitude(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertFinite("amplitude", volts);
    if (volts < 0) throw new FeelTechError(`amplitude must be >= 0 V, got ${volts}`);
    this.amplitude[channel] = volts;
    if (this.outputOn[channel]) await this.send(channel, `a${volts.toFixed(3)}`);
  }

  /** Set the DC offset in volts. */
  async setOffset(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertFinite("offset", volts);
    await this.send(channel, `o${volts.toFixed(2)}`);
  }

  /**
   * Set the duty cycle in percent.
   *
   * Note the encoding differs from every other FY model: this is an **integer**
   * of percent × 10 (`bd500` for 50 %), not the `WMD50.0` decimal form. Sending
   * the newer format here is silently ignored.
   */
  async setDutyCycle(channel: number, pct: number): Promise<void> {
    assertChannel(channel);
    assertRange("duty cycle", pct, 0.1, 99.9);
    await this.send(channel, `d${Math.round(pct * 10)}`);
  }

  /** Set the phase in degrees. The register belongs to CH2. */
  async setPhase(_channel: number, degrees: number): Promise<void> {
    assertFinite("phase", degrees);
    const normalised = ((degrees % 360) + 360) % 360;
    await this.send(1, `p${Math.round(normalised)}`);
  }

  /**
   * Switch the output.
   *
   * There is no relay command, so this writes the amplitude: 0 V for off, the
   * stored amplitude for on.
   */
  async setOutput(channel: number, enabled: boolean): Promise<void> {
    assertChannel(channel);
    this.outputOn[channel] = enabled;
    const volts = enabled ? (this.amplitude[channel] ?? 0) : 0;
    await this.send(channel, `a${volts.toFixed(3)}`);
  }

  async applyStep(channel: number, step: ChannelStep): Promise<void> {
    await applyStepSequentially(this, channel, step);
  }

  /** Send a raw command line, already including the channel prefix. */
  async raw(command: string): Promise<void> {
    await this.run(async () => {
      this.log(`>> ${command}`);
      await this.transport.write(command + "\n");
      await delay(this.opts.commandDelayMs);
    });
  }

  /** `b` addresses CH1, `d` addresses CH2. */
  private prefix(channel: number): string {
    return channel === 1 ? "d" : "b";
  }

  private async send(channel: number, command: string): Promise<void> {
    await this.raw(this.prefix(channel) + command);
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
    throw new FeelTechError(`Invalid channel ${channel} — the FY3200S has channels 0 and 1`);
  }
}

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot > 99) {
    throw new FeelTechError(`Waveform slot must be an integer 0..99, got ${slot}`);
  }
}

function assertFinite(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FeelTechError(`${name} must be a finite number, got ${value}`);
  }
}

function assertRange(name: string, value: number, min: number, max: number): void {
  assertFinite(name, value);
  if (value < min || value > max) {
    throw new FeelTechError(`${name} must be between ${min} and ${max}, got ${value}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
