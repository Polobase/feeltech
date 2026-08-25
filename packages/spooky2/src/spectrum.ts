/**
 * Spooky2 "Spectrum" — the frequency-cluster math.
 *
 * A Spectrum takes one *center* (MOR) frequency and produces a cluster of
 * *child* frequencies spread equally above and below it, spaced by a tolerance.
 * Spooky2 transmits them in parallel by baking the cluster into a computed
 * 1024-sample waveform (see `uploadWaveform`) played at the center frequency —
 * not as thousands of separate frequency commands.
 *
 * The formulas here are the Spooky2 User's Guide's, and the tests check them
 * against the guide's own worked examples:
 *
 *   Frequency Spacing = Center × Tolerance
 *   Spectrum %        = WaveCycleMultiplier × 100 × FrequencySpacing ÷ Center
 *
 * `tolerance` is a fraction (the guide's "0.025 %" = `0.00025`). The Wave Cycle
 * Multiplier (WCM) sets how many children are made **above** the center; the
 * same count is made below, so the total is `2 × WCM + 1` (children + center).
 */

export interface SpectrumParameters {
  centerHz: number;
  tolerance: number;
  waveCycleMultiplier: number;
  /** Distance between adjacent child frequencies, Hz. */
  frequencySpacingHz: number;
  /** The range the cluster spans, as a percentage of the center frequency. */
  spectrumPercent: number;
  /** Total number of frequencies produced (`2 × WCM + 1`). */
  frequencyCount: number;
  /** Lowest and highest frequency in the cluster. */
  lowHz: number;
  highHz: number;
}

/** Frequency Spacing = Center × Tolerance. */
export function frequencySpacing(centerHz: number, tolerance: number): number {
  return centerHz * tolerance;
}

/** Spectrum % = WCM × 100 × FrequencySpacing ÷ Center. */
export function spectrumPercent(
  centerHz: number,
  tolerance: number,
  waveCycleMultiplier: number,
): number {
  return (waveCycleMultiplier * 100 * frequencySpacing(centerHz, tolerance)) / centerHz;
}

/**
 * The child frequency list: `center + k × spacing` for `k = −WCM … +WCM`,
 * in ascending order (so the center sits in the middle).
 */
export function spectrumFrequencies(
  centerHz: number,
  tolerance: number,
  waveCycleMultiplier: number,
): number[] {
  const spacing = frequencySpacing(centerHz, tolerance);
  const out: number[] = [];
  for (let k = -waveCycleMultiplier; k <= waveCycleMultiplier; k++) {
    out.push(centerHz + k * spacing);
  }
  return out;
}

/** All Spectrum parameters for a center frequency, tolerance and WCM. */
export function spectrum(
  centerHz: number,
  tolerance: number,
  waveCycleMultiplier: number,
): SpectrumParameters {
  const spacing = frequencySpacing(centerHz, tolerance);
  return {
    centerHz,
    tolerance,
    waveCycleMultiplier,
    frequencySpacingHz: spacing,
    spectrumPercent: spectrumPercent(centerHz, tolerance, waveCycleMultiplier),
    frequencyCount: 2 * waveCycleMultiplier + 1,
    lowHz: centerHz - waveCycleMultiplier * spacing,
    highHz: centerHz + waveCycleMultiplier * spacing,
  };
}
