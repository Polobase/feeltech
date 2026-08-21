/**
 * Biofeedback scan analysis: running-average hit detection.
 *
 * The Gen X Pro's high-side detector reads output current (`:r11`) and phase
 * angle (`:r12`) at each frequency. Spooky2 turns those into a biofeedback scan
 * and flags "hit frequencies" — the frequencies where the response peaks.
 *
 * This module implements the *hit-detection* half of that, reverse-engineered
 * from Spooky2's own scan export (`RawAnalysisData.tmp` in the captures) and
 * confirmed against its `BFB_Frequencies.csv`:
 *
 * 1. `value` = the response at a frequency (current, in the capture).
 * 2. A running average (`window`, default 20) tracks the slow drift.
 * 3. `deviation = value − runningAverage` is the response strength.
 * 4. Peaks (local maxima of `value`, for `detect: "max"`) are candidate hits.
 * 5. The top `maxHits` peaks by deviation are the hits.
 *
 * The conversion of the raw register values into milliamps/degrees is *not*
 * here — that is hardware- and amplitude-dependent and, for hit detection,
 * irrelevant: a linear scale does not change which frequencies peak. The
 * caller passes whatever `value` it wants (raw `:r11` counts work).
 */

/** One measured point in a scan. */
export interface BiofeedbackPoint {
  hz: number;
  /** The response value (raw counts, mA, degrees — any monotonic scale). */
  value: number;
}

export interface DetectHitsOptions {
  /** Running-average window. Default 20 (Spooky2's `BFB_RA_Window_1`). */
  window?: number;
  /** Detect peaks of `value`. Default "max" (Spooky2's `BFB_Detect_Max`). */
  detect?: "max" | "min";
  /** Maximum hits to return. Default 60. */
  maxHits?: number;
}

/** A detected hit: the frequency and its response deviation from the average. */
export interface BiofeedbackHit {
  hz: number;
  deviation: number;
}

/**
 * Detect hit frequencies from a scan's samples.
 *
 * Pure: takes the measured points and returns the hit frequencies, ordered by
 * response strength (largest deviation first). The running average is the mean
 * of the previous `window` values (a cumulative mean while fewer than `window`
 * points exist), matching Spooky2's export exactly.
 */
export function detectHits(
  points: readonly BiofeedbackPoint[],
  options: DetectHitsOptions = {},
): BiofeedbackHit[] {
  const window = options.window ?? 20;
  const maxHits = options.maxHits ?? 60;
  const sign = options.detect === "min" ? -1 : 1;

  // Running average of previous values (cumulative during warm-up).
  const average: number[] = new Array(points.length);
  let sum = 0;
  for (let k = 0; k < points.length; k++) {
    if (k === 0) {
      average[0] = points[0]!.value;
      continue;
    }
    sum += points[k - 1]!.value;
    if (k - window - 1 >= 0) sum -= points[k - window - 1]!.value;
    average[k] = sum / (k - Math.max(0, k - window));
  }

  const deviation = points.map((p, k) => sign * (p.value - average[k]!));

  // Peaks: local maxima of `value` (for detect "max").
  const peaks: BiofeedbackHit[] = [];
  for (let k = 1; k < points.length - 1; k++) {
    const v = sign * points[k]!.value;
    const prev = sign * points[k - 1]!.value;
    const next = sign * points[k + 1]!.value;
    if (v > prev && v > next) {
      peaks.push({ hz: points[k]!.hz, deviation: deviation[k]! });
    }
  }

  peaks.sort((a, b) => b.deviation - a.deviation);
  return peaks.slice(0, maxHits);
}
