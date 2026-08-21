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
 * succeeds; before that every data register answers `:err`. The response is
 * computed by the bundled {@link GENX_AUTH_PROVIDER} (see
 * `genx-auth-transform.ts`), so a Pro authenticates and drives out of the box.
 * Pass a different `authProvider`, or `null`, to override or disable it. The
 * whole handshake is confirmed working against real hardware.
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
import { GENX_AUTH_PROVIDER } from "./genx-auth-transform.js";
import {
  channelSlot,
  encodeGenXFrequency,
  outField,
  amplitudeRegisterValue,
} from "./genx-wire.js";
import { presetProgramsForUpload, type Spooky2Preset } from "./presets.js";
import { SPOOKY2_WAVEFORMS, type Spooky2WaveformName } from "./waveforms.js";

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
  /**
   * Gating on/off — **both** outputs, two fields (Out1, Out2), like {@link output}.
   * A Spooky2 capture uses `:w12=<a>,<b>,`; register 70 (a vendor label called it
   * "Out 2 gating") is never sent, so gating is this single two-field register.
   */
  gating: 12,
  /** Out 2 modulation on/off. */
  modulationOut2: 13,
  /** Out 2 sync on/off. */
  syncOut2: 14,
  /**
   * Low-frequency mode — **both** outputs, two fields (Out1, Out2), like
   * {@link output}. A Spooky2 capture drives it as `:w15=1,1,` and never sends
   * register 51, so low-frequency mode is this single two-field register.
   */
  lowFreq: 15,
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
  /** Commit — written as `:w96=12321,`; seen right after writing generator memory. */
  commit: 96,
  authChallenge: 90,
  authResponse: 92,
} as const;

/**
 * Amplitude counts per volt for the *offline* `:p` amplitude field.
 *
 * This is centivolts of peak-to-peak voltage (`amplitudeVpp × 100`), confirmed
 * from a capture: a `20` preset stores `2000`. The *live* register (28/29) is
 * half of this — centivolts of peak amplitude — and is produced by
 * {@link amplitudeRegisterValue}.
 */
export const GENX_AMPLITUDE_SCALE = 100;

/**
 * Offset centre value and counts per full-scale.
 *
 * Centre `120` is from the vendor init (`:w32=120`). The span is confirmed from
 * a Spooky2 capture: a preset with `Out1_Offset=-100` / `Out2_Offset=100` was
 * driven as `:w32=20,` / `:w33=220,`, so the register is `120 + offset` with
 * offset in −100…+100.
 */
export const GENX_OFFSET_CENTRE = 120;
export const GENX_OFFSET_SPAN = 100;

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
   * Supplies the register-92 response.
   *
   * Defaults to the bundled {@link GENX_AUTH_PROVIDER}, so a Gen X Pro
   * authenticates and its outputs drive out of the box. Pass your own to
   * override it, or `null` to disable authentication (the driver still connects
   * and accesses registers, but the outputs stay gated).
   */
  authProvider?: AuthProvider | null;
  /** How long to wait for `:ok` / `:err` / data after a write. Default: 350 ms. */
  replyTimeoutMs?: number;
  /** Source of randomness for the auth nonce. Default: `Math.random`. */
  random?: () => number;
  debug?: boolean;
  logger?: (message: string, ...args: unknown[]) => void;
}

/** One reading from {@link GenXPro.biofeedbackScan}: the response at a frequency. */
export interface BiofeedbackSample {
  hz: number;
  /** Raw current detector counts, or `null` if the read failed. */
  current: number | null;
  /** Raw phase-angle detector counts, or `null` if the read failed. */
  phaseAngle: number | null;
}

export class GenXPro implements SignalGenerator {
  readonly info: DeviceInfo = { vendor: "Spooky2", model: "Gen X Pro" };

  /** True once the register-92 handshake has succeeded. */
  authenticated = false;

  private commandLock = Promise.resolve();
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
    // undefined → bundled provider; null → no auth; a provider → that provider.
    const authProvider =
      options.authProvider === undefined
        ? GENX_AUTH_PROVIDER
        : (options.authProvider ?? undefined);
    this.opts = {
      replyTimeoutMs: options.replyTimeoutMs ?? 350,
      random: options.random ?? Math.random,
      debug: options.debug ?? false,
      ...(authProvider !== undefined ? { authProvider } : {}),
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
   * Register bootstrap after unlocking.
   *
   * Close to the writes `Spooky.exe` issues on connect — clear Out 2 sync,
   * clear inversion, zero both frequencies, centre both offsets — with one
   * deliberate change: the low-frequency-mode register is set to **0**, not 1.
   *
   * At `w15 = 0` the exponent frequency encoding (see
   * {@link encodeGenXFrequency}) decodes directly on the device — a register
   * value of `10008` reads back as 1000 Hz. At `= 1` the same value reads ten
   * times lower. Since the exponent code already spans the whole frequency
   * range, 0 is the single mode this driver needs. Confirmed on hardware.
   */
  private async postAuthInit(): Promise<void> {
    for (const cmd of [
      ":w14=0,",
      ":w17=0,0,",
      ":w24=0,",
      ":w25=0,",
      ":w15=0,0,",
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
      await this.writeOut(reg, waveform);
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
    await this.writeOut(reg, code);
    return { requested: waveform, actual, substituted: direct === undefined, code };
  }

  /**
   * Set the output frequency.
   *
   * The value is exponent-encoded (see {@link encodeGenXFrequency}) and written
   * to the output's own register (24 for Out 1, 25 for Out 2). Confirmed on
   * hardware: the device display reads back exactly the requested frequency.
   */
  async setFrequency(channel: number, hz: number): Promise<void> {
    assertChannel(channel);
    assertFinite("frequency", hz);
    if (hz < 0) throw new AwgError(`frequency must be >= 0 Hz, got ${hz}`);
    const reg = channel === 0 ? GENX_PRO_REGISTERS.frequencyOut1 : GENX_PRO_REGISTERS.frequencyOut2;
    await this.writeOut(reg, encodeGenXFrequency(hz));
  }

  async setAmplitude(channel: number, volts: number): Promise<void> {
    assertChannel(channel);
    assertFinite("amplitude", volts);
    if (volts < 0) throw new AwgError(`amplitude must be >= 0 V, got ${volts}`);
    this.amplitude[channel] = volts;
    const reg = channel === 0 ? GENX_PRO_REGISTERS.amplitudeOut1 : GENX_PRO_REGISTERS.amplitudeOut2;
    await this.writeOut(reg, amplitudeRegisterValue(volts));
  }

  /**
   * Set the DC offset as a fraction of amplitude, −1…+1.
   *
   * `120` is centre; `+1` and `−1` map `GENX_OFFSET_SPAN` counts either side.
   * Both the centre and the span are confirmed from a Spooky2 capture
   * (`:w32=20,` for offset −100, `:w33=220,` for offset +100).
   */
  async setOffsetRatio(channel: number, ratio: number): Promise<void> {
    assertChannel(channel);
    assertFinite("offset ratio", ratio);
    const clamped = Math.max(-1, Math.min(1, ratio));
    const reg = channel === 0 ? GENX_PRO_REGISTERS.offsetOut1 : GENX_PRO_REGISTERS.offsetOut2;
    await this.writeOut(reg, GENX_OFFSET_CENTRE + Math.round(clamped * GENX_OFFSET_SPAN));
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
    await this.writeOut(GENX_PRO_REGISTERS.phaseOut2, Math.round(normalised));
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

  /**
   * Enable or disable gating for an output.
   *
   * Register 12 carries both outputs in two fields (`:w12=<Out1>,<Out2>,`),
   * confirmed by a Spooky2 capture — so this is a two-field write like
   * {@link setOutput}, leaving the other output's gating untouched.
   */
  async setGating(channel: number, on: boolean): Promise<void> {
    assertChannel(channel);
    await this.command(`:w${GENX_PRO_REGISTERS.gating}=${channelSlot(channel, on ? 1 : 0)}`);
  }

  /** Enable or disable Out 2 modulation. */
  async setModulation(on: boolean): Promise<void> {
    await this.writeOut(GENX_PRO_REGISTERS.modulationOut2, on ? 1 : 0);
  }

  /** Slave Out 2's frequency to Out 1 in hardware. */
  async setSync(on: boolean): Promise<void> {
    await this.writeOut(GENX_PRO_REGISTERS.syncOut2, on ? 1 : 0);
  }

  /**
   * Invert an output's waveform.
   *
   * Register 17 carries both outputs (the vendor init writes `:w17=0,0,`), so
   * this is one of the few two-field writes; the other output is left untouched.
   */
  async setInversion(channel: number, on: boolean): Promise<void> {
    assertChannel(channel);
    await this.command(`:w${GENX_PRO_REGISTERS.inversion}=${channelSlot(channel, on ? 1 : 0)}`);
  }

  /**
   * Force low-frequency mode on an output.
   *
   * Register 15 carries both outputs in two fields (`:w15=1,1,` in the capture),
   * so this is a two-field write like {@link setGating}, leaving the other
   * output's mode untouched.
   *
   * The driver keeps this at 0 (see {@link postAuthInit}), where the exponent
   * frequency encoding decodes directly. Setting it to 1 shifts decoded
   * frequencies down by a decade, so only use it if you also compensate.
   */
  async setLowFrequencyMode(channel: number, on: boolean): Promise<void> {
    assertChannel(channel);
    await this.command(`:w${GENX_PRO_REGISTERS.lowFreq}=${channelSlot(channel, on ? 1 : 0)}`);
  }

  /** Run the calibration routine. `load: "50ohm"` uses register 71, else 50. */
  async calibrate(load: "none" | "50ohm" = "none"): Promise<void> {
    const reg = load === "50ohm" ? GENX_PRO_REGISTERS.calibrate50Ohm : GENX_PRO_REGISTERS.calibrateNoLoad;
    await this.writeOut(reg, 1);
  }

  /** Reset the device (`:w95=12021,`). */
  async reset(): Promise<void> {
    await this.writeOut(GENX_PRO_REGISTERS.reset, 12021);
    this.outputOn = [false, false];
  }

  /**
   * Commit written generator memory (`:w96=12321,`).
   *
   * Spooky2 sends this after writing an offline program to memory; it appears to
   * finalise the write. {@link uploadProgram} calls it automatically.
   */
  async commitOfflineMemory(): Promise<void> {
    await this.writeOut(GENX_PRO_REGISTERS.commit, 12321);
  }

  /** Turn both outputs off. */
  async allOutputsOff(): Promise<void> {
    this.outputOn = [false, false];
    await this.command(`:w${GENX_PRO_REGISTERS.output}=0,0,`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Device info
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Read the firmware version (`:r02=`).
   *
   * The device answers with the version as a plain integer, e.g. `:r02=200.`
   * for firmware 200 (the unit this driver was verified against). Returns
   * `null` if the device does not answer with a number.
   */
  async readFirmwareVersion(): Promise<number | null> {
    const reply = await this.command(":r02=");
    const m = /=(\d+)/.exec(reply);
    return m ? Number(m[1]) : null;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Biofeedback
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Read the high-side biofeedback detector: output current and phase angle.
   *
   * These come from the read-side registers `:r11` (current) and `:r12` (phase),
   * confirmed to return live values on a real unit. The device specifies 16-bit
   * detection at 3.4 µA and 0.0015° resolution over 100 Hz–40 MHz, but the raw
   * register value is **not** a simple `count × resolution` — the conversion to
   * amps and degrees is not yet calibrated, so the raw integers are returned as
   * they are. They are still directly usable for *relative* measurements: a
   * biofeedback scan looks for the frequency where the response changes, which
   * needs only comparison, not absolute units.
   *
   * Returns `null` for a reading the device answered with `:err` (e.g. while
   * locked).
   */
  async readBiofeedback(): Promise<{ current: number | null; phaseAngle: number | null }> {
    const parse = (reply: string): number | null => {
      const m = /=(-?\d+(?:\.\d+)?)/.exec(reply);
      return m ? Number(m[1]) : null;
    };
    const current = parse(await this.command(":r11="));
    const phaseAngle = parse(await this.command(":r12="));
    return { current, phaseAngle };
  }

  /** Read just the biofeedback current (raw detector counts), or `null`. */
  async readCurrent(): Promise<number | null> {
    return (await this.readBiofeedback()).current;
  }

  /** Read just the biofeedback phase angle (raw detector counts), or `null`. */
  async readPhaseAngle(): Promise<number | null> {
    return (await this.readBiofeedback()).phaseAngle;
  }

  /**
   * Sweep a frequency range and record the biofeedback response at each step —
   * the biofeedback scan.
   *
   * This is exactly what the Spooky2 application does, confirmed by capturing
   * its serial traffic: for each frequency it writes `w24` and reads `r11`
   * (current) and `r12` (phase). There is no dedicated scan command on the
   * device — the scan is this host-side loop over the frequency register, so it
   * is reproduced faithfully here rather than delegated to hardware.
   *
   * The output is driven during the scan (a scan with no output reads only
   * noise). Returns one sample per step; the caller finds the resonance by
   * looking for where `current` peaks or `phaseAngle` turns.
   */
  async biofeedbackScan(options: {
    /** Range start in Hz. */
    startHz: number;
    /** Range end in Hz (may be below start — the sweep goes either direction). */
    endHz: number;
    /** Number of steps across the range. Mutually exclusive with `stepHz`. */
    steps?: number;
    /** Step size in Hz. Mutually exclusive with `steps`. */
    stepHz?: number;
    /** Channel to drive. Default 0. */
    channel?: number;
    /** Drive amplitude for the scan. Default: leave the current amplitude. */
    amplitudeVpp?: number;
    /** Settle time before reading, per step, in ms. Default 0. */
    dwellMs?: number;
    /** Number of passes to average (Spooky2's `BFB_Loops`). Default 1. */
    loops?: number;
    /**
     * Measure a baseline sweep first and subtract it from the loop average
     * (Spooky2's `Baseline_Before_BFB`). The returned current/phaseAngle are
     * then *deltas* from the impedance curve — the resonance response — ready
     * for {@link detectHits}.
     */
    baseline?: boolean;
    /** Turn the output off when the scan ends. Default true. */
    stopOutputAtEnd?: boolean;
    /** Cancel the scan. */
    signal?: AbortSignal;
    /** Called with each sample as it is taken (per loop). */
    onSample?: (sample: BiofeedbackSample) => void;
  }): Promise<BiofeedbackSample[]> {
    const channel = options.channel ?? 0;
    assertChannel(channel);
    if (!Number.isFinite(options.startHz) || !Number.isFinite(options.endHz)) {
      throw new AwgError("biofeedbackScan needs finite startHz and endHz");
    }
    const span = options.endHz - options.startHz;
    const steps =
      options.steps ??
      (options.stepHz ? Math.max(1, Math.round(Math.abs(span) / options.stepHz)) : 100);
    if (steps < 1) throw new AwgError("biofeedbackScan needs at least one step");
    const loops = Math.max(1, Math.round(options.loops ?? 1));

    if (options.amplitudeVpp !== undefined) {
      await this.setAmplitude(channel, options.amplitudeVpp);
    }
    await this.setOutput(channel, true);

    // One full sweep, returning the raw detector reading at each step (partial on abort).
    const sweep = async (): Promise<Array<{ current: number; phaseAngle: number }>> => {
      const out: Array<{ current: number; phaseAngle: number }> = [];
      for (let i = 0; i <= steps; i++) {
        if (options.signal?.aborted) break;
        const hz = options.startHz + (span * i) / steps;
        await this.setFrequency(channel, hz);
        if (options.dwellMs) await new Promise((r) => setTimeout(r, options.dwellMs));
        const { current, phaseAngle } = await this.readBiofeedback();
        out.push({ current: current ?? 0, phaseAngle: phaseAngle ?? 0 });
        options.onSample?.({ hz, current, phaseAngle });
      }
      return out;
    };
    const hzAt = (i: number) => options.startHz + (span * i) / steps;
    const subtract = (
      sums: Array<{ current: number; phaseAngle: number }>,
      baseline: Array<{ current: number; phaseAngle: number }> | null,
      divisor: number,
    ) =>
      sums.map((s, i) => ({
        hz: hzAt(i),
        current: s.current / divisor - (baseline?.[i]?.current ?? 0),
        phaseAngle: s.phaseAngle / divisor - (baseline?.[i]?.phaseAngle ?? 0),
      }));

    try {
      let baseline: Array<{ current: number; phaseAngle: number }> | null = null;
      if (options.baseline) {
        baseline = await sweep();
        if (options.signal?.aborted) return subtract(baseline, null, 1);
      }

      const sums = new Array<{ current: number; phaseAngle: number }>(steps + 1);
      for (let i = 0; i <= steps; i++) sums[i] = { current: 0, phaseAngle: 0 };
      for (let loop = 0; loop < loops; loop++) {
        const pass = await sweep();
        if (pass.length < steps + 1) return subtract(pass, baseline, 1);
        for (let i = 0; i <= steps; i++) {
          sums[i]!.current += pass[i]!.current;
          sums[i]!.phaseAngle += pass[i]!.phaseAngle;
        }
      }
      return subtract(sums, baseline, loops);
    } finally {
      if (options.stopOutputAtEnd ?? true) {
        try {
          await this.setOutput(channel, false);
        } catch {
          /* best effort */
        }
      }
    }
  }

  /**
   * Sweep a frequency range by stepping the frequency register — the plain
   * frequency sweep, with no biofeedback reads.
   *
   * A Spooky2 capture of a running program shows this is how sweeps reach the
   * device: the host writes `w24` once per step, linearly across the range
   * (~83 steps per range in the capture), holding each frequency for the dwell
   * time. There is no sweep command on the device — it is this host-side loop
   * over the frequency register, exactly like {@link biofeedbackScan} minus the
   * `r11`/`r12` reads.
   *
   * The output is driven during the sweep. Returns the list of frequencies
   * actually written (after exponent-encoding rounding).
   */
  async frequencySweep(options: {
    /** Range start in Hz. */
    startHz: number;
    /** Range end in Hz (may be below start — the sweep goes either direction). */
    endHz: number;
    /** Number of steps across the range. Mutually exclusive with `stepHz`. */
    steps?: number;
    /** Step size in Hz. Mutually exclusive with `steps`. */
    stepHz?: number;
    /** Channel to drive. Default 0. */
    channel?: number;
    /** Drive amplitude for the sweep. Default: leave the current amplitude. */
    amplitudeVpp?: number;
    /** DC offset as a fraction of amplitude, −1…+1. Default: leave current. */
    offsetRatio?: number;
    /** Hold time per step, in ms. Default 0. */
    dwellMs?: number;
    /** Turn the output off when the sweep ends. Default true. */
    stopOutputAtEnd?: boolean;
    /** Cancel the sweep. */
    signal?: AbortSignal;
    /** Called with each frequency as it is written. */
    onStep?: (hz: number) => void;
  }): Promise<number[]> {
    const channel = options.channel ?? 0;
    assertChannel(channel);
    if (!Number.isFinite(options.startHz) || !Number.isFinite(options.endHz)) {
      throw new AwgError("frequencySweep needs finite startHz and endHz");
    }
    const span = options.endHz - options.startHz;
    const steps =
      options.steps ??
      (options.stepHz ? Math.max(1, Math.round(Math.abs(span) / options.stepHz)) : 100);
    if (steps < 1) throw new AwgError("frequencySweep needs at least one step");

    if (options.amplitudeVpp !== undefined) {
      await this.setAmplitude(channel, options.amplitudeVpp);
    }
    if (options.offsetRatio !== undefined) {
      await this.setOffsetRatio(channel, options.offsetRatio);
    }
    await this.setOutput(channel, true);

    const swept: number[] = [];
    try {
      for (let i = 0; i <= steps; i++) {
        if (options.signal?.aborted) break;
        const hz = options.startHz + (span * i) / steps;
        await this.setFrequency(channel, hz);
        if (options.dwellMs) await new Promise((r) => setTimeout(r, options.dwellMs));
        swept.push(hz);
        options.onStep?.(hz);
      }
    } finally {
      if (options.stopOutputAtEnd ?? true) {
        try {
          await this.setOutput(channel, false);
        } catch {
          /* best effort */
        }
      }
    }
    return swept;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Waveform upload, display, offline programs (decoded from a Spooky2 capture)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Upload a waveform's sample table to a device slot.
   *
   * Decoded from a Spooky2 serial capture: the whole 1024-point table is sent in
   * one `:a<slot>=<s0>,<s1>,…,` command, each sample a 10-bit value (0–1023,
   * mid-scale 512). This is how the 23 Spooky2 waveforms get onto the device;
   * `setWaveform(ch, slot)` then selects the slot for output.
   *
   * Pass either a normalised table (−1…+1, e.g. from `SPOOKY2_WAVEFORMS`), which
   * is scaled to 0–1023, or raw 10-bit values with `{ raw: true }`. The device
   * expects 1024 samples; other lengths are sent as-is (the caller should
   * resample first).
   *
   * Not yet hardware-verified — reproduced from the captured command form.
   */
  async uploadWaveform(
    slot: number,
    samples: readonly number[],
    options: { raw?: boolean } = {},
  ): Promise<void> {
    if (!Number.isInteger(slot) || slot < 0) {
      throw new AwgError(`waveform slot must be a non-negative integer, got ${slot}`);
    }
    const encoded = options.raw
      ? samples.map((v) => clampSample(Math.round(v)))
      : samples.map((v) => clampSample(Math.round(((v + 1) / 2) * 1023)));
    await this.command(`:a${slot}=${encoded.join(",")},`);
  }

  /**
   * Set the text on the device display (`:n00=<text>`), e.g. a program name.
   * Confirmed present in the capture ("Port 3 - General Biofeedback").
   */
  async setDisplayText(text: string): Promise<void> {
    await this.command(`:n00=${text}`);
  }

  /**
   * Store a program in an offline slot for standalone (host-disconnected) running.
   *
   * Decoded from a Spooky2 capture: a program slot is written as
   * ```
   * :n<slot>=<name>
   * :p<slot>=<waveformSlot>,<amp×100>,<offset>,<dwell>,<count>,<f0>,…,<fN>,
   * :g<slot>=<gate schedule>
   * ```
   * The frequency field uses the same exponent encoding as the live `w24`
   * register (see {@link encodeGenXFrequency}) — confirmed from the capture:
   * `:p01=41,2000,120,600,1,7836,` is the 7.83 Hz Schumann program, and
   * `:p04=44,2000,120,2700,1,183586,` is the 183.58 Hz Plant Growth program.
   * The gate schedule carries **two values per frequency** (all-zero = no
   * gating): a 1-frequency program is `:g01=0,0,`, a 6-frequency program is
   * `:g07=0,0,0,0,0,0,0,0,0,0,0,0,`. The waveform itself is uploaded separately
   * with {@link uploadWaveform} to `waveformSlot` and referenced here by number.
   *
   * Structure and frequency encoding are confirmed from the capture; the dwell
   * unit is taken to match the live device (seconds) but was not independently
   * verified. Not yet hardware-tested.
   */
  async uploadProgram(
    slot: number,
    program: {
      /** Slot of a waveform previously sent with {@link uploadWaveform}. */
      waveformSlot: number;
      /** Amplitude in volts (→ ×100). */
      amplitudeVpp: number;
      /** Offset as a fraction of amplitude, −1…+1 (→ `120 ± 100`). Default 0. */
      offsetRatio?: number;
      /** Hold time per frequency. Default 180. */
      dwell?: number;
      /** Program frequencies in Hz (each stored exponent-encoded). */
      frequenciesHz: readonly number[];
      /** Optional program name (`:n<slot>=`). */
      name?: string;
      /** Optional gating schedule (`:g<slot>=`); default all-zero (no gating). */
      gate?: readonly number[];
    },
  ): Promise<void> {
    if (!Number.isInteger(slot) || slot < 0) {
      throw new AwgError(`program slot must be a non-negative integer, got ${slot}`);
    }
    const s = String(slot).padStart(2, "0");
    if (program.name !== undefined) await this.command(`:n${s}=${program.name}`);

    const amp = Math.round(program.amplitudeVpp * GENX_AMPLITUDE_SCALE);
    const offset =
      GENX_OFFSET_CENTRE +
      Math.round(Math.max(-1, Math.min(1, program.offsetRatio ?? 0)) * GENX_OFFSET_SPAN);
    const dwell = program.dwell ?? 180;
    const freqs = program.frequenciesHz.map(encodeGenXFrequency);
    const fields = [
      program.waveformSlot,
      amp,
      offset,
      dwell,
      freqs.length,
      ...freqs,
    ].join(",");
    await this.command(`:p${s}=${fields},`);

    // Two gate values per frequency (all-zero = no gating), per the capture.
    const gate = (program.gate ?? new Array(2 * freqs.length).fill(0)).join(",");
    await this.command(`:g${s}=${gate},`);

    // Spooky2 finalises a memory write with :w96=12321,
    await this.commitOfflineMemory();
  }

  /**
   * Low-level offline-slot write, for fields {@link uploadProgram} doesn't model.
   * `letter` is `n` (name), `p` (parameters) or `g` (gating).
   */
  async writeOfflineSlot(letter: "n" | "p" | "g", slot: number, value: string): Promise<void> {
    const s = String(slot).padStart(2, "0");
    await this.command(`:${letter}${s}=${value}`);
  }

  /**
   * Load a parsed Spooky2 preset into offline program slots.
   *
   * Reproduces the sequence a Spooky2 capture shows per program: upload the
   * waveform to a custom slot, then write the name, gate and parameters:
   * ```
   * :a<waveformSlot>=<samples>
   * :n<slot>=<name>
   * :g<slot>=<gate>
   * :p<slot>=<waveformSlot>,<amp×100>,<offset>,<dwell>,<count>,<freq…>,
   * ```
   * Programs go to consecutive slots starting at `startSlot` (1 in the capture),
   * each referencing a waveform uploaded to `waveformSlotBase + i` (41 in the
   * capture). Only single-frequency programs are loaded — range entries are
   * run-time sweeps (see {@link frequencySweep}) and DNA entries are not yet
   * decodable.
   *
   * Amplitude defaults to the preset's `Out1_Amplitude` setting. The offset
   * field stays at centre (120): a Spooky2 capture shows offline programs are
   * stored with offset 120 regardless of the preset's `Out1_Offset`, which is
   * applied at run time via the offset registers. Returns the number of
   * programs loaded.
   */
  async loadPreset(
    preset: Spooky2Preset,
    options: {
      /** First program slot. Default 1. */
      startSlot?: number;
      /** First waveform slot. Default 41. */
      waveformSlotBase?: number;
      /** Waveform uploaded to each program's slot. Default "sine". */
      waveform?: Spooky2WaveformName;
      /** Amplitude in volts. Default: the preset's `Out1_Amplitude`. */
      amplitudeVpp?: number;
      /** Offset as a fraction of amplitude, −1…+1. Default 0 (centre 120). */
      offsetRatio?: number;
    } = {},
  ): Promise<number> {
    const programs = presetProgramsForUpload(preset);
    const startSlot = options.startSlot ?? 1;
    const waveformSlotBase = options.waveformSlotBase ?? 41;
    const waveform = options.waveform ?? "sine";
    const samples = SPOOKY2_WAVEFORMS[waveform];
    const amplitudeVpp =
      options.amplitudeVpp ?? Number(preset.settings["Out1_Amplitude"] ?? 20);

    for (let i = 0; i < programs.length; i++) {
      const program = programs[i]!;
      const slot = startSlot + i;
      const waveformSlot = waveformSlotBase + i;
      await this.uploadWaveform(waveformSlot, samples);
      await this.uploadProgram(slot, {
        waveformSlot,
        amplitudeVpp,
        offsetRatio: options.offsetRatio ?? 0,
        dwell: program.dwell,
        name: program.name,
        frequenciesHz: program.frequenciesHz,
      });
    }
    return programs.length;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Wire
  // ────────────────────────────────────────────────────────────────────────

  /** Send a raw command and return the device's reply. */
  async raw(command: string): Promise<string> {
    return this.command(command);
  }

  /**
   * Write a value to an output-specific register (field 1): `:w<reg>=<v>,`.
   * Confirmed on hardware — these registers read field 1 regardless of output.
   */
  private async writeOut(register: number, value: number): Promise<void> {
    await this.command(`:w${register}=${outField(value)}`);
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

/** Clamp a waveform sample into the device's 10-bit range. */
function clampSample(v: number): number {
  return v < 0 ? 0 : v > 1023 ? 1023 : v;
}
