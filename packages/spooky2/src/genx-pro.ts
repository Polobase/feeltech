/**
 * Spooky2 Gen X Pro driver.
 *
 * **Verification status: unverified.** The register map and command sequences
 * come from third-party reverse engineering of the vendor application. They are
 * reproduced here as protocol facts and pinned by wire-transcript tests.
 *
 * ## Why this driver overrides `applyStep`
 *
 * The Pro cannot be driven parameter-by-parameter. Writing a frequency and
 * expecting output does not work: the device needs its display text set, the
 * channel prepared, an arm sequence written, the frequency *ramped* up in steps
 * — a single jump to the target produces silence — and only then the amplitude.
 * {@link GenXPro.applyStep} performs that whole sequence, and the fine-grained
 * setters are thin wrappers that re-run it rather than pretending to be
 * independent.
 *
 * ## Output is gated behind authentication
 *
 * Registers accept writes and answer reads, but the outputs stay dead until the
 * register-92 handshake succeeds. This package ships no response algorithm —
 * see `auth.ts` for why, and for the {@link AuthProvider} hook that lets you
 * supply one.
 */

import {
  AwgError,
  DEFAULT_CAPABILITIES,
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

import { generateNonce, type AuthChallenge, type AuthProvider } from "./auth.js";
import {
  amplitudeRegisterValue,
  armRegisterValue,
  channelSlot,
  displayRegisterValue,
} from "./genx-wire.js";

export const GENX_PRO_REGISTERS = {
  output: 11,
  reset: 12,
  clear: 13,
  channelSelect: 14,
  amplitude: 17,
  ddsA: 20,
  ddsB: 21,
  arm: 24,
  displayFrequencyA: 28,
  displayFrequencyB: 29,
  offsetA: 32,
  offsetB: 33,
  stop: 40,
  authChallenge: 90,
  authResponse: 92,
} as const;

/** Slots 11 (sine) and 12 (square) — the only two established. */
const GENX_WAVEFORM_SLOTS: Readonly<Partial<Record<WaveformKind, number>>> = {
  sine: 11,
  square: 12,
};
const GENX_WAVEFORMS: readonly WaveformKind[] = ["sine", "square"];

/**
 * Cap on intermediate ramp steps.
 *
 * The ramp walks up in 50 Hz increments, which is fine at audio frequencies but
 * absurd higher up — 30 kHz would be 599 steps. Above this count the walk
 * switches to even division so any target is reached in roughly the same time.
 */
export const GENX_RAMP_MAX_STEPS = 24;

/** Delay between ramp steps, in ms. */
const RAMP_STEP_DELAY_MS = 40;

export interface GenXProOptions {
  /**
   * Supplies the register-92 response. Without one the driver connects and
   * configures normally but the outputs stay gated.
   */
  authProvider?: AuthProvider;
  /** How long to wait for `:ok` / `:err` / data after a write. Default: 250 ms. */
  replyTimeoutMs?: number;
  /** Label shown on the device display. Default: "awg". */
  displayName?: string;
  /** Amplitude used when a step does not specify one. Default: 5 V. */
  defaultAmplitudeVpp?: number;
  /** Source of randomness for the auth nonce. Default: `Math.random`. */
  random?: () => number;
  debug?: boolean;
  logger?: (message: string, ...args: unknown[]) => void;
}

export class GenXPro implements SignalGenerator {
  readonly info: DeviceInfo = { vendor: "Spooky2", model: "Gen X Pro" };

  /** True once the register-92 handshake has succeeded. */
  authenticated = false;

  private commandLock = Promise.resolve();
  private preparedChannel: number | null = null;
  private lastHz: number | null = null;
  private lastAmplitude: number;
  private outputMask: [0 | 1, 0 | 1] = [1, 1];
  private opts: Required<Omit<GenXProOptions, "authProvider" | "logger">> & {
    authProvider?: AuthProvider;
    logger: (message: string, ...args: unknown[]) => void;
  };

  constructor(
    public readonly transport: Transport,
    options: GenXProOptions = {},
  ) {
    this.opts = {
      replyTimeoutMs: options.replyTimeoutMs ?? 250,
      displayName: options.displayName ?? "awg",
      defaultAmplitudeVpp: options.defaultAmplitudeVpp ?? 5,
      random: options.random ?? Math.random,
      debug: options.debug ?? false,
      ...(options.authProvider !== undefined
        ? { authProvider: options.authProvider }
        : {}),
      logger:
        options.logger ??
        ((msg: string, ...rest: unknown[]) =>
          console.log("[spooky2-genx-pro]", msg, ...rest)),
    };
    this.lastAmplitude = this.opts.defaultAmplitudeVpp;
  }

  get capabilities(): Capabilities {
    return {
      ...DEFAULT_CAPABILITIES,
      channels: 2,
      requiresAuth: true,
      requiresFrequencyRamp: true,
      waveforms: GENX_WAVEFORMS,
      limits: unknownLimits(
        false,
        "No frequency limits established. The Pro is marketed as a 40 MHz " +
          "instrument, but that figure has not been confirmed here.",
        ["third-party Gen X protocol notes"],
      ),
    };
  }

  /**
   * Open the port and attempt authentication if a provider was supplied.
   *
   * A failed or absent handshake is not fatal — the link stays up so registers
   * can still be written and read. It does mean the outputs will stay dead.
   */
  async open(): Promise<void> {
    await this.transport.open({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
    if (this.opts.authProvider) {
      try {
        await this.authenticate();
      } catch (err) {
        this.log("authentication failed — output will stay gated:", err);
      }
    } else {
      this.log(
        "no authProvider supplied — registers are writable but output stays gated",
      );
    }
  }

  async close(): Promise<void> {
    try {
      await this.stopOutput();
    } catch {
      /* closing anyway */
    }
    await this.transport.close();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Authentication
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Run the register-92 handshake.
   *
   * Two rounds, because a single successful exchange has been observed not to
   * unlock the outputs on its own. Each round retries up to three times, since
   * the device sometimes echoes the nonce back instead of answering.
   */
  async authenticate(): Promise<boolean> {
    const provider = this.opts.authProvider;
    if (!provider) {
      throw new AwgError(
        "Gen X Pro output is gated behind a register-92 handshake and this package " +
          "ships no response algorithm. Supply an `authProvider` to unlock it — see " +
          "the AuthProvider docs.",
      );
    }

    for (let round = 1; round <= 2; round++) {
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        const nonce = generateNonce(this.opts.random);
        const reply = await this.command(
          `:r${GENX_PRO_REGISTERS.authChallenge}=${nonce},`,
        );
        // A valid challenge is two numbers of at least nine digits. A short or
        // absent reply means the device echoed rather than answered.
        const match = /(\d{9,}),(\d{9,})/.exec(reply);
        if (!match) {
          this.log(`auth round ${round} attempt ${attempt}: no challenge in ${JSON.stringify(reply)}`);
          continue;
        }
        const challenge: AuthChallenge = { nonce, v1: match[1]!, v2: match[2]! };
        const response = await provider.respond(challenge);
        const ack = await this.command(
          `:w${GENX_PRO_REGISTERS.authResponse}=${response}.`,
        );
        if (/:?ok/i.test(ack)) ok = true;
        else this.log(`auth round ${round} attempt ${attempt}: ${JSON.stringify(ack)}`);
      }
      if (!ok) {
        this.authenticated = false;
        throw new AwgError(`Gen X Pro authentication failed at round ${round}`);
      }
    }

    this.authenticated = true;
    await this.postAuthInit();
    return true;
  }

  /** Register bootstrap the device expects immediately after unlocking. */
  private async postAuthInit(): Promise<void> {
    for (const cmd of [
      ":w14=0,",
      ":w17=0,0,",
      ":w24=0,",
      ":w25=0,",
      ":w15=1,1,",
      ":w24=00,",
      ":w32=120,",
      ":w33=120,",
    ]) {
      await this.command(cmd);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // The step sequence
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Apply a complete channel state.
   *
   * This is the only way to get output out of a Gen X Pro. Fields the device
   * has no register for (offset, duty, phase) are accepted at their neutral
   * values and rejected otherwise, so a preset that specifies "duty 50 %"
   * works while one that asks for 25 % fails loudly instead of silently
   * running at the wrong shape.
   */
  async applyStep(channel: number, step: ChannelStep): Promise<void> {
    assertChannel(channel);
    this.rejectUnsupported(step);

    if (step.output === false) {
      await this.stopOutput();
      return;
    }

    if (step.waveform !== undefined) await this.setWaveform(channel, step.waveform);

    const hz = step.frequencyHz ?? this.lastHz;
    if (hz === null) {
      throw new AwgError(
        "The Gen X Pro has no way to arm an output without a frequency — " +
          "include frequencyHz in the first step",
      );
    }
    const amplitude = step.amplitudeVpp ?? this.lastAmplitude;
    await this.runStep(channel, hz, amplitude);
  }

  /**
   * Display text → prepare → arm → ramp → amplitude.
   *
   * The ordering is not a preference. The arm sequence is what makes the DDS
   * emit, the ramp is what makes it emit at the target frequency, and amplitude
   * last is what stops a channel briefly running loud at the wrong setting.
   */
  async runStep(channel: number, hz: number, amplitudeVpp: number): Promise<void> {
    assertChannel(channel);
    assertFinite("frequency", hz);
    if (hz < 0) throw new AwgError(`frequency must be >= 0 Hz, got ${hz}`);

    if (this.preparedChannel !== channel) await this.prepareChannel(channel);
    await this.setDisplayText(`${this.opts.displayName} G${channel + 1} - ${formatHz(hz)}`);
    await this.armSequence(channel, hz);
    await this.rampTo(hz);
    await this.setAmplitude(channel, amplitudeVpp);
    this.lastHz = hz;
  }

  /** One-time per-channel setup, run lazily before the first step on a channel. */
  async prepareChannel(channel: number): Promise<void> {
    assertChannel(channel);
    await this.setDisplayText(`${this.opts.displayName} G${channel + 1} - Stopped`);
    await this.sequence([":w13=0,", ":w28=0,", ":w29=0,", ":w24=00,"]);
    await this.resetRegister12();
    // Registers 32 and 33 are the offset registers; 120 is their neutral value.
    // The `:w40=0,` after each is part of the stop sequence, not a latch — it is
    // included here because that is where it belongs, and must not be lifted out
    // and reused elsewhere, where it silently kills the output.
    await this.sequence([":w32=120,", ":w40=0,", ":w33=120,", ":w40=0,"]);

    const [own, other] = channel === 0 ? ["w20", "w21"] : ["w21", "w20"];
    await this.sequence([":w13=0,", `:${own}=12,`]);
    await this.resetRegister12();
    await this.sequence([
      `:${other}=12,`,
      ":w13=0,",
      `:${own}=14,`,
      `:w14=${channel + 1},`,
    ]);
    await this.resetRegister12();
    await this.command(":w21=25,");
    this.preparedChannel = channel;
  }

  private async armSequence(channel: number, hz: number): Promise<void> {
    await this.command(":w13=0,");
    await this.command(channel === 0 ? ":w20=14," : ":w21=14,");
    await this.command(`:w24=${armRegisterValue(hz)},`);
    await this.resetRegister12();
    await this.command(":w21=25,");
    await this.command(`:w11=${this.outputMask[0]},${this.outputMask[1]},`);
  }

  /**
   * Walk the frequency up to the target.
   *
   * A single jump to the target leaves the output silent, so the display
   * registers are stepped. Below {@link GENX_RAMP_MAX_STEPS} intermediate steps
   * the walk uses 50 Hz increments; above that it divides the interval evenly,
   * keeping the ramp inside about a second at any frequency.
   */
  private async rampTo(targetHz: number): Promise<void> {
    const target = Math.max(0, targetHz);
    const fiftyHzSteps = Math.max(0, Math.ceil(target / 50) - 1);

    if (fiftyHzSteps <= GENX_RAMP_MAX_STEPS) {
      for (let f = 50; f < target; f += 50) await this.writeRampPoint(f);
    } else {
      for (let i = 1; i <= GENX_RAMP_MAX_STEPS; i++) {
        await this.writeRampPoint((target * i) / (GENX_RAMP_MAX_STEPS + 1));
      }
    }
    await this.writeRampPoint(target, false);
  }

  private async writeRampPoint(hz: number, pause = true): Promise<void> {
    const v = displayRegisterValue(hz);
    await this.command(`:w28=${v},`);
    await this.command(`:w29=${v},`);
    if (pause) await new Promise((r) => setTimeout(r, RAMP_STEP_DELAY_MS));
  }

  /**
   * Stop output.
   *
   * Register 11 is disarmed first — without that the output sticks at whatever
   * frequency register 24 last held.
   */
  async stopOutput(): Promise<void> {
    await this.command(":w11=0,0,");
    await this.sequence([":w13=0,", ":w28=0,", ":w29=0,", ":w24=00,"]);
    this.lastHz = null;
    this.preparedChannel = null;
    this.outputMask = [1, 1];
  }

  // ────────────────────────────────────────────────────────────────────────
  // Fine-grained setters
  // ────────────────────────────────────────────────────────────────────────

  async setWaveform(
    channel: number,
    waveform: WaveformKind | number,
  ): Promise<AppliedWaveform> {
    assertChannel(channel);
    if (typeof waveform === "number") {
      await this.command(`:w22=${channelSlot(channel, waveform)}`);
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
    const actual = direct !== undefined ? waveform : substituteWaveform(waveform, GENX_WAVEFORMS);
    if (actual === undefined) {
      throw new AwgError(
        `The Gen X Pro has only sine and square slots; nothing can stand in for "${waveform}"`,
      );
    }
    const code = GENX_WAVEFORM_SLOTS[actual]!;
    await this.command(`:w22=${channelSlot(channel, code)}`);
    return { requested: waveform, actual, substituted: direct === undefined, code };
  }

  /** Re-runs the whole step sequence — the Pro has no standalone frequency write. */
  async setFrequency(channel: number, hz: number): Promise<void> {
    await this.runStep(channel, hz, this.lastAmplitude);
  }

  async setAmplitude(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertFinite("amplitude", volts);
    if (volts < 0) throw new AwgError(`amplitude must be >= 0 V, got ${volts}`);
    this.lastAmplitude = volts;
    const cv = amplitudeRegisterValue(volts);
    // Register 17 carries both outputs; the Pro drives them together.
    await this.command(`:w17=${cv},${cv},`);
  }

  async setOutput(channel: number, enabled: boolean): Promise<void> {
    assertChannel(channel);
    if (!enabled) {
      await this.stopOutput();
      return;
    }
    if (this.lastHz === null) {
      throw new AwgError(
        "Nothing to enable — the Gen X Pro arms its output as part of a step, so " +
          "set a frequency (or call applyStep) first",
      );
    }
    await this.runStep(channel, this.lastHz, this.lastAmplitude);
  }

  /** Not available: writing the offset registers outside the stop sequence kills output. */
  async setOffset(_channel: number, volts: number): Promise<void> {
    if (volts === 0) return;
    throw new AwgError(
      "DC offset is not supported on the Gen X Pro. Registers 32 and 33 do carry " +
        "the offset, but the only known way to latch them sits inside the stop " +
        "sequence, and writing them outside it has been observed to silence the " +
        "output entirely.",
    );
  }

  /** Not available: no duty register has been identified. */
  async setDutyCycle(_channel: number, pct: number): Promise<void> {
    if (pct === 50) return;
    throw new AwgError(
      `No duty-cycle register is known for the Gen X Pro, so ${pct}% cannot be set.`,
    );
  }

  /** Not available: no phase register has been identified. */
  async setPhase(_channel: number, degrees: number): Promise<void> {
    if (degrees === 0) return;
    throw new AwgError(
      `No phase register is known for the Gen X Pro, so ${degrees}° cannot be set.`,
    );
  }

  /** Set which outputs the arm sequence enables. */
  async setOutputMask(out1: boolean, out2: boolean): Promise<void> {
    const mask: [0 | 1, 0 | 1] = [out1 ? 1 : 0, out2 ? 1 : 0];
    if (mask[0] === this.outputMask[0] && mask[1] === this.outputMask[1]) return;
    this.outputMask = mask;
    await this.command(`:w11=${mask[0]},${mask[1]},`);
  }

  /** Set the text on the device display. Also acts as an output gate. */
  async setDisplayText(text: string): Promise<void> {
    await this.command(`:n00=${text}`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Wire
  // ────────────────────────────────────────────────────────────────────────

  /** Send a raw command and return the device's reply. */
  async raw(command: string): Promise<string> {
    return this.command(command);
  }

  private async sequence(commands: readonly string[]): Promise<void> {
    for (const c of commands) await this.command(c);
  }

  private async resetRegister12(): Promise<void> {
    await this.sequence([":w12=0,,", ":w12=,0,"]);
  }

  /**
   * Write one command and wait for the device to answer before returning.
   *
   * The pacing is load-bearing: the Pro drops commands that arrive while it is
   * still answering the previous one.
   */
  private async command(command: string): Promise<string> {
    return this.run(async () => {
      this.log(`>> ${command}`);
      await this.transport.write(command + "\r\n");
      const reply = await readReply(this.transport, this.opts.replyTimeoutMs);
      if (reply === null) {
        this.log(`!! no reply to ${command} within ${this.opts.replyTimeoutMs} ms`);
        return "";
      }
      this.log(`<< ${reply.trim()}`);
      return reply.trim();
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

  private rejectUnsupported(step: ChannelStep): void {
    if (step.offsetV !== undefined && step.offsetV !== 0) {
      throw new AwgError("DC offset is not supported on the Gen X Pro");
    }
    if (step.dutyCyclePct !== undefined && step.dutyCyclePct !== 50) {
      throw new AwgError("Duty cycle is not adjustable on the Gen X Pro");
    }
    if (step.phaseDeg !== undefined && step.phaseDeg !== 0) {
      throw new AwgError("Phase is not adjustable on the Gen X Pro");
    }
  }
}

function formatHz(hz: number): string {
  return `${Number.isInteger(hz) ? hz : Number(hz.toFixed(6))} Hz`;
}

function assertChannel(channel: number): void {
  if (channel !== 0 && channel !== 1) {
    throw new AwgError(`Invalid channel ${channel} — the Gen X Pro has channels 0 and 1`);
  }
}

function assertFinite(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AwgError(`${name} must be a finite number, got ${value}`);
  }
}
