/**
 * Spooky2 Gen X Pro driver.
 *
 * ## Register assignments — confirmed
 *
 * The register map here is the vendor's own. Spooky2's application
 * (`Spooky.exe`) labels each command in its debug/log strings — `:w24=` is
 * " Out 1 Frequency", `:w28=` is " Out 1 Amplitude", and so on — and that
 * labelling was cross-checked on a real Gen X Pro (firmware 200): with the
 * output driven, stepping `:w28` moved the device's own biofeedback current
 * sensor while stepping `:w17` did not, confirming `:w28` is amplitude and
 * `:w17` is not. See `docs/spooky2-command-set.md`.
 *
 * This replaces an earlier map from third-party reverse engineering that had
 * `:w28`/`:w29` as a "display-frequency ramp" and `:w17` as amplitude. Under
 * that map a bare frequency write seemed to produce no output, which led to an
 * elaborate arm-and-ramp sequence. The sequence was really ramping the
 * *amplitude* (`:w28`/`:w29`) up from zero — which is why output "appeared" —
 * and the Gen X in fact drives like any other register device.
 *
 * ## Encodings — assignments confirmed, scale factors are not
 *
 * Which register does what is settled. The *scale factors* (how many counts per
 * hertz, per volt) could not be measured without an oscilloscope, so the values
 * below mirror the Spooky2 XM, the closest analogue, and are marked accordingly.
 * Correct them once you can put a scope on the output.
 *
 * ## Output is gated behind authentication
 *
 * Registers accept writes and answer reads only after the register-92 handshake
 * succeeds; before that every data register answers `:err`. This package ships
 * no response algorithm — see `auth.ts` for why, and for the {@link AuthProvider}
 * hook that supplies one. The handshake itself is implemented and confirmed
 * working against real hardware.
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

import { generateNonce, type AuthChallenge, type AuthProvider } from "./auth.js";
import { channelSlot } from "./genx-wire.js";

/**
 * Register map, from Spooky2's own debug labels.
 *
 * Live-control registers take two comma-separated fields, one per output;
 * addressing one leaves the other empty (`:w28=5,,` / `:w28=,5,`). A handful
 * (reset) take a single value.
 */
export const GENX_PRO_REGISTERS = {
  /** Output on/off. `:w11=1,,` Out1 on, `:w11=,1,` Out2 on, `:w11=0,0,` both off. */
  output: 11,
  /** Out 1 gating on/off. */
  gatingOut1: 12,
  /** Out 2 gating on/off. */
  gatingOut2: 70,
  /** Out 2 modulation on/off. */
  modulationOut2: 13,
  /** Out 2 sync on/off. */
  syncOut2: 14,
  /** Out 1 low-frequency mode on/off. */
  lowFreqOut1: 15,
  /** Out 2 low-frequency mode on/off. */
  lowFreqOut2: 51,
  /** Waveform inversion (field 1 = Out1, field 2 = Out2). */
  inversion: 17,
  /** Out 1 waveform number. */
  waveformOut1: 20,
  /** Out 2 waveform number. */
  waveformOut2: 21,
  /** Out 1 frequency. */
  frequencyOut1: 24,
  /** Out 2 frequency. */
  frequencyOut2: 25,
  /** Out 1 amplitude. */
  amplitudeOut1: 28,
  /** Out 2 amplitude. */
  amplitudeOut2: 29,
  /** Out 1 offset (120 = centre). */
  offsetOut1: 32,
  /** Out 2 offset (120 = centre). */
  offsetOut2: 33,
  /** Out 2 phase angle. Out 1 has no phase register. */
  phaseOut2: 40,
  /** Calibrate, no load. */
  calibrateNoLoad: 50,
  /** Calibrate, 50 Ω load. */
  calibrate50Ohm: 71,
  /** Device reset — written as `:w95=12021,`. */
  reset: 95,
  authChallenge: 90,
  authResponse: 92,
} as const;

/**
 * Frequency scale, **mirrored from the XM — not scope-confirmed on the GX.**
 *
 * The XM sends Hz×100 above a boundary and Hz×100000 below it, flipping a scale
 * register; the GX has a "low frequency mode" register (`:w15`/`:w51`) that is
 * the obvious counterpart. Adjust once measured.
 */
export const GENX_FREQ_SCALE_HIGH = 100;
export const GENX_FREQ_SCALE_LOW = 100_000;
export const GENX_FREQ_LOW_BOUNDARY_HZ = 600;

/** Amplitude counts per volt. Mirrored from the XM (centivolts); not confirmed. */
export const GENX_AMPLITUDE_SCALE = 100;

/** Offset centre value and counts per full-scale, from the vendor init (`:w32=120`). */
export const GENX_OFFSET_CENTRE = 120;
export const GENX_OFFSET_SPAN = 50;

/** Slots 11 (sine) and 12 (square) — the only two the third-party notes name;
 * the vendor waveform table (`Waveforms.csv`) suggests more but their register
 * numbers are unconfirmed, so only these two are mapped. */
const GENX_WAVEFORM_SLOTS: Readonly<Partial<Record<WaveformKind, number>>> = {
  sine: 11,
  square: 12,
};
const GENX_WAVEFORMS: readonly WaveformKind[] = ["sine", "square"];

export interface GenXProOptions {
  /**
   * Supplies the register-92 response. Without one the driver connects and
   * reads/writes registers, but the outputs stay gated.
   */
  authProvider?: AuthProvider;
  /** How long to wait for `:ok` / `:err` / data after a write. Default: 350 ms. */
  replyTimeoutMs?: number;
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
  private lowFreqMode: [boolean, boolean] = [false, false];
  private amplitude: [number, number] = [0, 0];
  private outputOn: [boolean, boolean] = [false, false];
  private opts: Required<Omit<GenXProOptions, "authProvider" | "logger">> & {
    authProvider?: AuthProvider;
    logger: (message: string, ...args: unknown[]) => void;
  };

  constructor(
    public readonly transport: Transport,
    options: GenXProOptions = {},
  ) {
    this.opts = {
      replyTimeoutMs: options.replyTimeoutMs ?? 350,
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
  }

  get capabilities(): Capabilities {
    return {
      ...DEFAULT_CAPABILITIES,
      channels: 2,
      requiresAuth: true,
      // The arm/ramp requirement was an artefact of a mis-read register map.
      requiresFrequencyRamp: false,
      waveforms: GENX_WAVEFORMS,
      limits: unknownLimits(
        false,
        "Register assignments confirmed from the vendor application and hardware; " +
          "frequency and amplitude scale factors are mirrored from the XM and not " +
          "scope-confirmed. No frequency limits established.",
        ["Spooky.exe debug labels", "Gen X Pro firmware 200 (biofeedback probe)"],
      ),
    };
  }

  /**
   * Open the port and attempt authentication if a provider was supplied.
   *
   * A failed or absent handshake is not fatal — the link stays up so registers
   * remain accessible — but the outputs will stay dead.
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
        "no authProvider supplied — registers are accessible but output stays gated",
      );
    }
  }

  async close(): Promise<void> {
    try {
      await this.allOutputsOff();
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

  /**
   * Register bootstrap the vendor sends immediately after unlocking.
   *
   * These are the exact writes `Spooky.exe` issues on connect: clear Out 2 sync,
   * clear inversion, zero both frequencies, enable low-frequency mode on both,
   * centre both offsets. Kept verbatim.
   */
  private async postAuthInit(): Promise<void> {
    this.lowFreqMode = [true, true];
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
  // Parameters
  // ────────────────────────────────────────────────────────────────────────

  async setWaveform(
    channel: number,
    waveform: WaveformKind | number,
  ): Promise<AppliedWaveform> {
    assertChannel(channel);
    const reg = channel === 0 ? GENX_PRO_REGISTERS.waveformOut1 : GENX_PRO_REGISTERS.waveformOut2;
    if (typeof waveform === "number") {
      await this.writeChannel(reg, channel, waveform);
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
        `The Gen X Pro has only sine and square slots mapped; nothing can stand in for "${waveform}"`,
      );
    }
    const code = GENX_WAVEFORM_SLOTS[actual]!;
    await this.writeChannel(reg, channel, code);
    return { requested: waveform, actual, substituted: direct === undefined, code };
  }

  /**
   * Set the output frequency.
   *
   * Switches low-frequency mode across {@link GENX_FREQ_LOW_BOUNDARY_HZ}, the
   * way the XM does — see the scale-factor caveat at the top of this file.
   */
  async setFrequency(channel: number, hz: number): Promise<void> {
    assertChannel(channel);
    assertFinite("frequency", hz);
    if (hz < 0) throw new AwgError(`frequency must be >= 0 Hz, got ${hz}`);

    const low = hz < GENX_FREQ_LOW_BOUNDARY_HZ;
    if (this.lowFreqMode[channel] !== low) {
      const reg = channel === 0 ? GENX_PRO_REGISTERS.lowFreqOut1 : GENX_PRO_REGISTERS.lowFreqOut2;
      await this.writeChannel(reg, channel, low ? 1 : 0);
      this.lowFreqMode[channel] = low;
    }
    const scale = low ? GENX_FREQ_SCALE_LOW : GENX_FREQ_SCALE_HIGH;
    const reg = channel === 0 ? GENX_PRO_REGISTERS.frequencyOut1 : GENX_PRO_REGISTERS.frequencyOut2;
    await this.writeChannel(reg, channel, Math.round(hz * scale));
  }

  async setAmplitude(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertFinite("amplitude", volts);
    if (volts < 0) throw new AwgError(`amplitude must be >= 0 V, got ${volts}`);
    this.amplitude[channel] = volts;
    const reg = channel === 0 ? GENX_PRO_REGISTERS.amplitudeOut1 : GENX_PRO_REGISTERS.amplitudeOut2;
    await this.writeChannel(reg, channel, Math.round(volts * GENX_AMPLITUDE_SCALE));
  }

  /**
   * Set the DC offset as a fraction of amplitude, −1…+1.
   *
   * `120` is centre; `+1` and `−1` map `GENX_OFFSET_SPAN` counts either side.
   * The centre is confirmed from the vendor init; the span is an estimate.
   */
  async setOffsetRatio(channel: number, ratio: number): Promise<void> {
    assertChannel(channel);
    assertFinite("offset ratio", ratio);
    const clamped = Math.max(-1, Math.min(1, ratio));
    const reg = channel === 0 ? GENX_PRO_REGISTERS.offsetOut1 : GENX_PRO_REGISTERS.offsetOut2;
    await this.writeChannel(reg, channel, GENX_OFFSET_CENTRE + Math.round(clamped * GENX_OFFSET_SPAN));
  }

  /** Set the DC offset in volts, converted against the channel's amplitude. */
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

  /**
   * Set the phase in degrees. Only Out 2 (channel 1) has a phase register — the
   * Gen X aligns Out 2 against Out 1, so Out 1 has no independent phase.
   */
  async setPhase(channel: number, degrees: number): Promise<void> {
    assertChannel(channel);
    assertFinite("phase", degrees);
    if (channel === 0) {
      if (degrees === 0) return;
      throw new AwgError(
        "The Gen X Pro has no Out 1 phase register — phase is set on Out 2 " +
          "relative to Out 1. Call setPhase(1, …).",
      );
    }
    const normalised = ((degrees % 360) + 360) % 360;
    await this.writeChannel(GENX_PRO_REGISTERS.phaseOut2, channel, Math.round(normalised));
  }

  /** Duty cycle is not adjustable — no register for it exists. */
  async setDutyCycle(_channel: number, pct: number): Promise<void> {
    if (pct === 50) return;
    throw new AwgError(
      `No duty-cycle register is known for the Gen X Pro, so ${pct}% cannot be set.`,
    );
  }

  async setOutput(channel: number, enabled: boolean): Promise<void> {
    assertChannel(channel);
    this.outputOn[channel] = enabled;
    // Register 11 carries both outputs; send the current pair.
    await this.command(
      `:w${GENX_PRO_REGISTERS.output}=${this.outputOn[0] ? 1 : 0},${this.outputOn[1] ? 1 : 0},`,
    );
  }

  /**
   * Apply a complete channel state.
   *
   * The Gen X drives like any register device, so this is the plain sequential
   * application — waveform first (duty depends on it elsewhere in the family),
   * output last.
   */
  async applyStep(channel: number, step: ChannelStep): Promise<void> {
    await applyStepSequentially(this, channel, step);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Per-output extras (vendor-labelled)
  // ────────────────────────────────────────────────────────────────────────

  /** Enable or disable gating for an output. */
  async setGating(channel: number, on: boolean): Promise<void> {
    assertChannel(channel);
    const reg = channel === 0 ? GENX_PRO_REGISTERS.gatingOut1 : GENX_PRO_REGISTERS.gatingOut2;
    await this.writeChannel(reg, channel, on ? 1 : 0);
  }

  /** Enable or disable Out 2 modulation. */
  async setModulation(on: boolean): Promise<void> {
    await this.writeChannel(GENX_PRO_REGISTERS.modulationOut2, 1, on ? 1 : 0);
  }

  /** Slave Out 2's frequency to Out 1 in hardware. */
  async setSync(on: boolean): Promise<void> {
    await this.writeChannel(GENX_PRO_REGISTERS.syncOut2, 1, on ? 1 : 0);
  }

  /** Invert an output's waveform. */
  async setInversion(channel: number, on: boolean): Promise<void> {
    assertChannel(channel);
    await this.writeChannel(GENX_PRO_REGISTERS.inversion, channel, on ? 1 : 0);
  }

  /** Force low-frequency mode on an output (normally handled by setFrequency). */
  async setLowFrequencyMode(channel: number, on: boolean): Promise<void> {
    assertChannel(channel);
    const reg = channel === 0 ? GENX_PRO_REGISTERS.lowFreqOut1 : GENX_PRO_REGISTERS.lowFreqOut2;
    await this.writeChannel(reg, channel, on ? 1 : 0);
    this.lowFreqMode[channel] = on;
  }

  /** Run the calibration routine. `load: "50ohm"` uses register 71, else 50. */
  async calibrate(load: "none" | "50ohm" = "none"): Promise<void> {
    const reg = load === "50ohm" ? GENX_PRO_REGISTERS.calibrate50Ohm : GENX_PRO_REGISTERS.calibrateNoLoad;
    await this.command(`:w${reg}=1,,`);
  }

  /** Reset the device (`:w95=12021,`). */
  async reset(): Promise<void> {
    await this.command(`:w${GENX_PRO_REGISTERS.reset}=12021,`);
    this.outputOn = [false, false];
    this.lowFreqMode = [false, false];
  }

  /** Turn both outputs off. */
  async allOutputsOff(): Promise<void> {
    this.outputOn = [false, false];
    await this.command(`:w${GENX_PRO_REGISTERS.output}=0,0,`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Wire
  // ────────────────────────────────────────────────────────────────────────

  /** Send a raw command and return the device's reply. */
  async raw(command: string): Promise<string> {
    return this.command(command);
  }

  private async writeChannel(register: number, channel: number, value: number): Promise<void> {
    await this.command(`:w${register}=${channelSlot(channel, value)}`);
  }

  /**
   * Write one command and wait for the device to answer before returning.
   *
   * The pacing is load-bearing: the Pro drops commands that arrive while it is
   * still answering the previous one. A reply that misses its window is drained
   * by {@link readReply} so it cannot answer the next command.
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
