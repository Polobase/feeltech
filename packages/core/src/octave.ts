/**
 * Octave folding — moving a frequency into a device's usable band by doubling
 * or halving it.
 *
 * Rife-style frequency sets routinely contain entries far outside what any
 * generator can emit (megahertz-range molecular frequencies, sub-hertz
 * entries). The established convention is not to reject them but to shift them
 * by whole octaves until they land in range, on the premise that an octave is
 * treated as equivalent. A worked example from the field: a 320 MHz fundamental
 * appears in databases as 20 MHz (halved 16 times); halving it 8 more times
 * gives exactly 2.5 MHz.
 *
 * This module is pure arithmetic — no I/O, no device knowledge. It answers
 * "how many octaves of shift would this take, and is it even possible", so a
 * caller can decide between running, warning, or refusing.
 */

export interface Band {
  /** Inclusive lower bound in Hz. Omitted or 0 ⇒ unbounded below. */
  loHz?: number | null;
  /** Inclusive upper bound in Hz. Omitted or null ⇒ unbounded above. */
  hiHz?: number | null;
}

export interface FoldResult {
  /** The shifted frequency, inside the band. */
  hz: number;
  /** Octaves applied: positive = doubled up, negative = halved down, 0 = native. */
  octaves: number;
}

/**
 * Iteration guard. 64 octaves is a factor of ~1.8e19 — far beyond any real
 * band — so hitting it means the inputs are degenerate rather than merely wide.
 */
const MAX_OCTAVES = 64;

/**
 * Shift `hz` by whole octaves until it falls within `band`.
 *
 * Returns `null` when no octave lands inside — which happens for bands narrower
 * than one octave (`hiHz < loHz * 2`), where a frequency can step from below
 * the floor straight past the ceiling.
 */
export function foldToBand(hz: number, band: Band): FoldResult | null {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const lo = band.loHz ?? 0;
  const hi = band.hiHz ?? null;
  if (hi != null && !(hi > 0)) return null;

  let f = hz;
  let octaves = 0;
  while (hi != null && f > hi && octaves > -MAX_OCTAVES) {
    f /= 2;
    octaves -= 1;
  }
  while (lo > 0 && f < lo && octaves < MAX_OCTAVES) {
    f *= 2;
    octaves += 1;
  }
  if (lo > 0 && f < lo) return null;
  if (hi != null && f > hi) return null;
  return { hz: f, octaves };
}

export type FitStatus = "native" | "shift" | "partial" | "blocked";

export type FitWarning =
  /** At least one frequency exceeds the generator's own cap, before banding. */
  | "gen-cap"
  /** The cap in use is the sine figure standing in for an unknown square figure. */
  | "cap-assumed"
  /** No cap is known for this device at all. */
  | "cap-unknown"
  /** Some frequencies land in the band but outside its optimal sub-range. */
  | "out-of-optimal";

export interface FitOptions {
  /**
   * Generator's own upper bound in Hz, independent of the band. `null` means
   * unknown — reported as a `cap-unknown` warning rather than assumed infinite.
   */
  capHz?: number | null;
  /** Where the cap came from, so an assumed value can be flagged. */
  capSource?: "user" | "spec" | "assumed-sine" | "unknown";
  /** Narrower sub-range within the band where the device performs best. */
  optimal?: Band;
}

export interface FitResult {
  status: FitStatus;
  /** Largest shift needed, signed. */
  maxShift: number;
  /** How many frequencies need a shift. */
  shifted: number;
  /** How many cannot be placed in the band at all. */
  blocked: number;
  /** How many land in the band but outside the optimal sub-range. */
  outOfOptimal: number;
  /** How many exceed the generator cap. */
  overCap: number;
  total: number;
  warnings: FitWarning[];
}

/**
 * Assess how well a set of frequencies fits a band on a given generator.
 *
 * `status` is the headline:
 * - `native`  — everything already in band, nothing to do
 * - `shift`   — everything fits after octave shifting
 * - `partial` — everything fits, but nothing lands in the optimal sub-range
 * - `blocked` — at least one frequency cannot be placed at all
 */
export function fitFrequencies(
  freqs: readonly number[],
  band: Band,
  options: FitOptions = {},
): FitResult {
  const capHz = options.capHz ?? null;
  const effectiveHi =
    capHz != null && band.hiHz != null
      ? Math.min(band.hiHz, capHz)
      : (band.hiHz ?? capHz ?? null);
  const effectiveBand: Band = { loHz: band.loHz ?? null, hiHz: effectiveHi };

  const list = freqs.filter((f) => Number.isFinite(f) && f > 0);
  let shifted = 0;
  let blocked = 0;
  let outOfOptimal = 0;
  let overCap = 0;
  let maxShift = 0;

  for (const f of list) {
    if (capHz != null && f > capHz) overCap += 1;
    const folded = foldToBand(f, effectiveBand);
    if (!folded) {
      blocked += 1;
      continue;
    }
    if (folded.octaves !== 0) {
      shifted += 1;
      if (Math.abs(folded.octaves) > Math.abs(maxShift)) maxShift = folded.octaves;
    }
    if (options.optimal) {
      const lo = options.optimal.loHz ?? 0;
      const hi = options.optimal.hiHz ?? null;
      if (folded.hz < lo || (hi != null && folded.hz > hi)) outOfOptimal += 1;
    }
  }

  let status: FitStatus = blocked > 0 ? "blocked" : shifted > 0 ? "shift" : "native";
  if (status !== "blocked" && list.length > 0 && outOfOptimal === list.length) {
    status = "partial";
  }

  const warnings: FitWarning[] = [];
  if (overCap > 0) warnings.push("gen-cap");
  if (outOfOptimal > 0) warnings.push("out-of-optimal");
  if (options.capSource === "assumed-sine") warnings.push("cap-assumed");
  if (options.capSource === "unknown") warnings.push("cap-unknown");

  return {
    status,
    maxShift,
    shifted,
    blocked,
    outOfOptimal,
    overCap,
    total: list.length,
    warnings,
  };
}
