/**
 * Frequency limits, and how much we actually know about them.
 *
 * The discipline here is deliberate: `null` means **unknown**, and unknown is
 * never quietly replaced with a guess. Catalogue figures for these generators
 * are almost always quoted for a *sine* output; square and arbitrary bandwidth
 * are lower and usually undocumented. Since most therapeutic/Rife-style presets
 * drive square waves, the square figure is the one that actually constrains a
 * run — so reporting a sine number as if it were the square limit would be
 * worse than admitting we don't know.
 *
 * Several models also ship under one name with different maximum frequencies
 * (the FY6900 exists as 20/40/60/80/100 MHz variants), which is why
 * {@link resolveCap} accepts a per-user override.
 */

/**
 * How well a limit is established.
 * - `true`      — confirmed against real hardware or an unambiguous official spec
 * - `"partial"` — one waveform kind confirmed, the others unknown
 * - `false`     — taken from third-party protocol notes only, never verified here
 */
export type VerificationLevel = true | "partial" | false;

/** A single inclusive frequency range. `null` on either end means unknown. */
export interface FrequencyRange {
  minHz: number | null;
  maxHz: number | null;
}

export interface FrequencyLimits {
  sine: FrequencyRange;
  square: FrequencyRange;
  arbitrary: FrequencyRange;
  verified: VerificationLevel;
  /** Why the numbers are what they are, or why they're missing. */
  note?: string;
  /** Where the figures came from, e.g. "mattwach/fygen", "FY6900 manual Rev 1.8". */
  sources?: readonly string[];
}

/** Which bandwidth figure applies to the waveform being generated. */
export type WaveformClass = "sine" | "square" | "arbitrary";

/** Per-waveform-class user overrides, for model variants we can't detect. */
export type LimitOverride = Partial<Record<WaveformClass, number>>;

export interface ResolvedCap {
  /** Effective maximum in Hz, or `null` when genuinely unknown. */
  hz: number | null;
  source: "user" | "spec" | "assumed-sine" | "unknown";
}

/**
 * Effective upper bound for a waveform class.
 *
 * Falls back to the sine figure only as an explicitly-labelled *upper bound
 * assumption* (`source: "assumed-sine"`), because square bandwidth can never
 * exceed sine bandwidth on these DDS designs — it is an honest ceiling, not a
 * claim about the real limit. Callers should surface that label rather than
 * treat the number as a specification.
 */
export function resolveCap(
  limits: FrequencyLimits,
  kind: WaveformClass,
  override?: LimitOverride,
): ResolvedCap {
  const user = override?.[kind];
  if (user != null && Number.isFinite(user)) return { hz: user, source: "user" };

  const spec = limits[kind].maxHz;
  if (spec != null) return { hz: spec, source: "spec" };

  if (kind !== "sine" && limits.sine.maxHz != null) {
    return { hz: limits.sine.maxHz, source: "assumed-sine" };
  }
  return { hz: null, source: "unknown" };
}

/** An all-unknown limit set, for drivers with no published figures at all. */
export function unknownLimits(
  verified: VerificationLevel = false,
  note?: string,
  sources?: readonly string[],
): FrequencyLimits {
  const range = (): FrequencyRange => ({ minHz: null, maxHz: null });
  return {
    sine: range(),
    square: range(),
    arbitrary: range(),
    verified,
    ...(note !== undefined ? { note } : {}),
    ...(sources !== undefined ? { sources } : {}),
  };
}
