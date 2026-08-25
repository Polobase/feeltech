/**
 * The driver-facing contract every generator implements.
 *
 * Two levels on purpose:
 *
 * - **Fine-grained setters** (`setFrequency`, `setAmplitude`, …) for devices
 *   that accept parameters independently, in any order. FeelTech FY and
 *   Spooky2 XM work this way.
 *
 * - **{@link SignalGenerator.applyStep}**, which applies a whole channel state
 *   at once. This is not sugar: on the Gen X a bare frequency write produces no
 *   output at all — the device needs its display text, channel prepare, arm
 *   sequence, a *stepped* frequency ramp and only then amplitude, in that
 *   order. Drivers with such an ordering override `applyStep`; the rest inherit
 *   {@link applyStepSequentially}.
 *
 * Callers that want portable behaviour should prefer `applyStep`.
 */

import type { Capabilities } from "./capabilities.js";

/**
 * Vendor-neutral waveform vocabulary.
 *
 * Deliberately small — it covers what the supported devices share and what
 * preset formats actually ask for. Anything richer is reached through the
 * device-native numeric code, which every setter also accepts.
 */
export type WaveformKind =
  | "sine"
  | "square"
  | "triangle"
  | "ramp-up"
  | "ramp-down"
  | "dc"
  | "noise"
  | "custom";

/**
 * What the device will really output after a waveform request.
 *
 * `substituted` is the point of this type: the Gen X has only sine and square
 * slots, so a sawtooth request becomes a sine. Returning that fact instead of
 * silently swapping lets callers warn, refuse, or carry on knowingly.
 */
export interface AppliedWaveform {
  requested: WaveformKind;
  actual: WaveformKind;
  substituted: boolean;
  /** Device-native waveform index that was written. */
  code: number;
}

/** A complete channel state. Every field is optional; omitted ones are left alone. */
export interface ChannelStep {
  waveform?: WaveformKind | number;
  frequencyHz?: number;
  amplitudeVpp?: number;
  offsetV?: number;
  dutyCyclePct?: number;
  phaseDeg?: number;
  output?: boolean;
}

export interface DeviceInfo {
  /** Manufacturer, e.g. "FeelTech", "Spooky2". */
  vendor: string;
  /** Model as configured or auto-detected, e.g. "FY6300", "Gen X Pro". */
  model: string;
  /** Raw identity string the device reported, when it can report one. */
  reportedId?: string;
}

export interface SignalGenerator {
  readonly info: DeviceInfo;
  readonly capabilities: Capabilities;

  open(): Promise<void>;
  close(): Promise<void>;

  setWaveform(channel: number, waveform: WaveformKind | number): Promise<AppliedWaveform>;
  setFrequency(channel: number, hz: number): Promise<void>;
  setAmplitude(channel: number, volts: number): Promise<void>;
  setOffset(channel: number, volts: number): Promise<void>;
  setDutyCycle(channel: number, pct: number): Promise<void>;
  setPhase(channel: number, degrees: number): Promise<void>;
  setOutput(channel: number, enabled: boolean): Promise<void>;

  /** Apply a complete channel state, respecting any device-required ordering. */
  applyStep(channel: number, step: ChannelStep): Promise<void>;
}

/**
 * Default `applyStep` for devices with no required ordering.
 *
 * Waveform goes first because duty is waveform-dependent on some firmwares
 * (FY6900), and `output` goes last so a channel never turns on mid-configuration
 * with stale parameters.
 */
export async function applyStepSequentially(
  device: Pick<
    SignalGenerator,
    | "setWaveform"
    | "setFrequency"
    | "setAmplitude"
    | "setOffset"
    | "setDutyCycle"
    | "setPhase"
    | "setOutput"
  >,
  channel: number,
  step: ChannelStep,
): Promise<void> {
  if (step.waveform !== undefined) await device.setWaveform(channel, step.waveform);
  if (step.frequencyHz !== undefined) await device.setFrequency(channel, step.frequencyHz);
  if (step.amplitudeVpp !== undefined) await device.setAmplitude(channel, step.amplitudeVpp);
  if (step.offsetV !== undefined) await device.setOffset(channel, step.offsetV);
  if (step.dutyCyclePct !== undefined) await device.setDutyCycle(channel, step.dutyCyclePct);
  if (step.phaseDeg !== undefined) await device.setPhase(channel, step.phaseDeg);
  if (step.output !== undefined) await device.setOutput(channel, step.output);
}

/**
 * Resolve a requested kind against what a device can produce, choosing the
 * closest available substitute.
 *
 * Preference chains are ordered by how little the shape changes: a ramp
 * degrades to a triangle before a square, because a triangle keeps the linear
 * slopes; square degrades to sine rather than to a ramp, because it keeps the
 * symmetry. Returns `undefined` when nothing sensible is available.
 */
export function substituteWaveform(
  requested: WaveformKind,
  available: readonly WaveformKind[],
): WaveformKind | undefined {
  if (available.includes(requested)) return requested;
  const fallbacks: Record<WaveformKind, readonly WaveformKind[]> = {
    sine: ["triangle", "square"],
    square: ["sine", "triangle"],
    triangle: ["ramp-up", "sine", "square"],
    "ramp-up": ["triangle", "ramp-down", "sine"],
    "ramp-down": ["ramp-up", "triangle", "sine"],
    dc: ["sine"],
    noise: ["sine"],
    custom: ["sine", "square"],
  };
  return fallbacks[requested].find((k) => available.includes(k));
}
