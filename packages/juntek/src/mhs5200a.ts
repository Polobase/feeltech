/**
 * MHS-5200A driver — MHINSTEK/JUNTEK hardware, usually sold under the
 * Koolertron brand.
 *
 * Wire format: 57600 8N1, `:s<channel><letter><value>` terminated with LF,
 * answered `ok`. Channels are numbered from 1 on the wire, unlike the register
 * arithmetic the JDS6600 uses.
 *
 * Two quirks change behaviour rather than just encoding:
 *
 * - **Output on/off is device-global.** There is one `:s1b<0|1>` switch for the
 *   whole instrument, not one per channel. `setOutput()` therefore keeps a
 *   per-channel intent and drives the hardware switch from whether *either*
 *   channel wants output; a channel asked to be off is silenced by writing 0 V.
 * - **Amplitude depends on the attenuator.** `open()` pins it to 0 dB so the
 *   volts-to-centivolts conversion holds; without that the same number would
 *   mean different things depending on the front-panel state.
 *
 * **Verification status: unverified.** Implemented from the protocol as
 * described by `peterska/go-mhs5200a`, `raplin/python_mhs5200` and the sigrok
 * project; not checked against hardware here.
 */

import {
  AwgError,
  DEFAULT_CAPABILITIES,
  applyStepSequentially,
  readReply,
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

/** Command letters, appended to `:s<channel>`. */
export const MHS_COMMANDS = {
  frequency: "f",
  waveform: "w",
  amplitude: "a",
  offset: "o",
  duty: "d",
  phase: "p",
  /** Device-global output switch — always addressed as channel 1. */
  output: "b",
  /** Attenuator; `1` is 0 dB. */
  attenuation: "y",
} as const;

/** Slot 3 is a rising ramp on this model, unlike the JDS6600's triangle. */
const MHS_WAVEFORM_SLOTS: Readonly<Partial<Record<WaveformKind, number>>> = {
  sine: 0,
  square: 1,
  triangle: 2,
  "ramp-up": 3,
};

const MHS_WAVEFORMS: readonly WaveformKind[] = ["sine", "square", "triangle", "ramp-up"];

export interface Mhs5200aOptions {
  /** Pause between commands in ms. Default: 15. */
  commandDelayMs?: number;
  /** How long to wait for `ok`. Default: 300 ms. */
  ackTimeoutMs?: number;
  /** Throw when an acknowledgement does not arrive. Default: false. */
  strictAck?: boolean;
  debug?: boolean;
  logger?: (message: string, ...args: unknown[]) => void;
}

export class Mhs5200a implements SignalGenerator {
  readonly info: DeviceInfo = { vendor: "Koolertron", model: "MHS-5200A" };

  private commandLock = Promise.resolve();
  /** Per-channel intent; the hardware switch is global. */
  private wantOutput: [boolean, boolean] = [false, false];
  private amplitude: [number, number] = [0, 0];
  private opts: Required<Omit<Mhs5200aOptions, "logger">> & {
    logger: (message: string, ...args: unknown[]) => void;
  };

  constructor(
    public readonly transport: Transport,
    options: Mhs5200aOptions = {},
  ) {
    this.opts = {
      commandDelayMs: options.commandDelayMs ?? 15,
      ackTimeoutMs: options.ackTimeoutMs ?? 300,
      strictAck: options.strictAck ?? false,
      debug: options.debug ?? false,
      logger:
        options.logger ??
        ((msg: string, ...rest: unknown[]) => console.log("[mhs5200a]", msg, ...rest)),
    };
  }

  get capabilities(): Capabilities {
    return {
      ...DEFAULT_CAPABILITIES,
      channels: 2,
      // One output switch for the whole instrument.
      perChannelOutput: false,
      waveforms: MHS_WAVEFORMS,
      limits: unknownLimits(
        false,
        "No frequency limits established for the MHS-5200A.",
        ["peterska/go-mhs5200a", "raplin/python_mhs5200", "sigrok"],
      ),
    };
  }

  /**
   * Open the port and pin the attenuator to 0 dB.
   *
   * Amplitude is expressed relative to the attenuator setting, so fixing it at
   * connect time is what makes `setAmplitude(ch, 5)` mean 5 V rather than
   * "5 V or 0.5 V depending on how the panel was left".
   */
  async open(): Promise<void> {
    await this.transport.open({
      baudRate: 57600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
    await this.send(0, MHS_COMMANDS.attenuation, 1);
    await this.send(1, MHS_COMMANDS.attenuation, 1);
  }

  async close(): Promise<void> {
    try {
      this.wantOutput = [false, false];
      await this.writeGlobalOutput(false);
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
      await this.send(channel, MHS_COMMANDS.waveform, waveform);
      const kind = (Object.keys(MHS_WAVEFORM_SLOTS) as WaveformKind[]).find(
        (k) => MHS_WAVEFORM_SLOTS[k] === waveform,
      );
      return {
        requested: kind ?? "custom",
        actual: kind ?? "custom",
        substituted: false,
        code: waveform,
      };
    }

    const direct = MHS_WAVEFORM_SLOTS[waveform];
    const actual =
      direct !== undefined ? waveform : substituteWaveform(waveform, MHS_WAVEFORMS);
    if (actual === undefined) {
      throw new AwgError(
        `The MHS-5200A has no mapped waveform that can stand in for "${waveform}"`,
      );
    }
    const code = MHS_WAVEFORM_SLOTS[actual]!;
    await this.send(channel, MHS_COMMANDS.waveform, code);
    return { requested: waveform, actual, substituted: direct === undefined, code };
  }

  /** Set the frequency. The command takes centihertz. */
  async setFrequency(channel: number, hz: number): Promise<void> {
    assertChannel(channel);
    assertFinite("frequency", hz);
    if (hz < 0) throw new AwgError(`frequency must be >= 0 Hz, got ${hz}`);
    await this.send(channel, MHS_COMMANDS.frequency, Math.round(Math.max(0, hz) * 100));
  }

  /**
   * Set the peak-to-peak amplitude, 0–20 V.
   *
   * Held back while the channel is muted, because amplitude is how a muted
   * channel stays silent on an instrument with only a global output switch.
   */
  async setAmplitude(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertRange("amplitude", volts, 0, 20);
    this.amplitude[channel] = volts;
    if (this.wantOutput[channel]) {
      await this.send(channel, MHS_COMMANDS.amplitude, Math.round(volts * 100));
    }
  }

  /**
   * Set the DC offset as a fraction of amplitude, −1…+1.
   *
   * The command takes percent biased by 120, so `120` is 0 and the usable span
   * is 20…220.
   */
  async setOffsetRatio(channel: number, ratio: number): Promise<void> {
    assertChannel(channel);
    assertFinite("offset ratio", ratio);
    const clamped = Math.max(-1, Math.min(1, ratio));
    await this.send(channel, MHS_COMMANDS.offset, Math.round(clamped * 100) + 120);
  }

  /**
   * Set the DC offset in volts.
   *
   * Converted against the channel's amplitude, since the device states offset
   * as a percentage of it. Set amplitude first when both change.
   */
  async setOffset(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertFinite("offset", volts);
    const half = (this.amplitude[channel] ?? 0) / 2;
    if (half <= 0) {
      if (volts === 0) return this.setOffsetRatio(channel, 0);
      throw new AwgError(
        "Cannot express an offset in volts while the amplitude is 0 — " +
          "set an amplitude first, or use setOffsetRatio()",
      );
    }
    await this.setOffsetRatio(channel, volts / half);
  }

  /** Set the duty cycle in percent, at 0.1 % resolution. */
  async setDutyCycle(channel: number, pct: number): Promise<void> {
    assertChannel(channel);
    assertRange("duty cycle", pct, 0, 100);
    await this.send(channel, MHS_COMMANDS.duty, Math.round(pct * 10));
  }

  /** Set the phase in whole degrees. */
  async setPhase(channel: number, degrees: number): Promise<void> {
    assertChannel(channel);
    assertFinite("phase", degrees);
    const normalised = ((degrees % 360) + 360) % 360;
    await this.send(channel, MHS_COMMANDS.phase, Math.round(normalised));
  }

  /**
   * Switch a channel's output.
   *
   * The hardware switch is global, so this records the per-channel intent,
   * drives the global switch from whether *either* channel wants output, and
   * silences an unwanted channel by writing 0 V. Enabling a channel restores
   * its stored amplitude.
   */
  async setOutput(channel: number, enabled: boolean): Promise<void> {
    assertChannel(channel);
    this.wantOutput[channel] = enabled;
    await this.send(
      channel,
      MHS_COMMANDS.amplitude,
      enabled ? Math.round((this.amplitude[channel] ?? 0) * 100) : 0,
    );
    await this.writeGlobalOutput(this.wantOutput[0] || this.wantOutput[1]);
  }

  async applyStep(channel: number, step: ChannelStep): Promise<void> {
    await applyStepSequentially(this, channel, step);
  }

  /** Send a raw command line. */
  async raw(command: string): Promise<void> {
    await this.run(async () => {
      this.log(`>> ${command}`);
      await this.transport.write(command + "\n");
      await this.expectAck(command);
    });
  }

  private async writeGlobalOutput(on: boolean): Promise<void> {
    await this.send(0, MHS_COMMANDS.output, on ? 1 : 0);
  }

  /** Channels are 1-based on the wire. */
  private async send(channel: number, letter: string, value: number): Promise<void> {
    const command = `:s${channel + 1}${letter}${value}`;
    await this.run(async () => {
      this.log(`>> ${command}`);
      await this.transport.write(command + "\n");
      await this.expectAck(command);
      if (this.opts.commandDelayMs > 0) await delay(this.opts.commandDelayMs);
    });
  }

  private async expectAck(command: string): Promise<void> {
    const raw = await readReply(this.transport, this.opts.ackTimeoutMs);
    if (raw === null) {
      if (this.opts.strictAck) {
        throw new AwgError(`No acknowledgement for ${command}`);
      }
      this.log(`!! no acknowledgement for ${command} — continuing`);
      return;
    }
    const line = raw.trim();
    if (line.length > 0 && !/^:?ok$/i.test(line)) {
      this.log(`!! unexpected reply to ${command}: ${JSON.stringify(line)}`);
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
    throw new AwgError(`Invalid channel ${channel} — the MHS-5200A has channels 0 and 1`);
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
