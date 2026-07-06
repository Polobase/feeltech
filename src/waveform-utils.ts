/**
 * Helpers for preparing arbitrary waveform data before upload.
 *
 * `uploadWaveform()` requires exactly `sampleCount` samples (8192 by default);
 * these utilities adapt arbitrary-length data to that requirement.
 */

import { FeelTechError } from "./types.js";

/**
 * Resample a waveform to `targetLength` points using linear interpolation.
 * The first and last samples are preserved exactly.
 */
export function resampleWaveform(
  values: readonly number[],
  targetLength = 8192,
): number[] {
  if (values.length === 0) {
    throw new FeelTechError("resampleWaveform requires at least one sample");
  }
  if (!Number.isInteger(targetLength) || targetLength < 1) {
    throw new FeelTechError(`targetLength must be a positive integer, got ${targetLength}`);
  }
  if (values.length === targetLength) return [...values];
  if (values.length === 1 || targetLength === 1) {
    return new Array<number>(targetLength).fill(values[0]!);
  }

  const out = new Array<number>(targetLength);
  const scale = (values.length - 1) / (targetLength - 1);
  for (let i = 0; i < targetLength; i++) {
    const pos = i * scale;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, values.length - 1);
    const frac = pos - i0;
    out[i] = values[i0]! * (1 - frac) + values[i1]! * frac;
  }
  return out;
}

/**
 * Scale a waveform symmetrically into the −1…+1 range expected by
 * `uploadWaveform()`'s default `minValue`/`maxValue`.
 * Constant input maps to all zeros (mid-scale).
 */
export function normalizeWaveform(values: readonly number[]): number[] {
  if (values.length === 0) {
    throw new FeelTechError("normalizeWaveform requires at least one sample");
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) {
      throw new FeelTechError(`normalizeWaveform: sample is not finite (${v})`);
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) return values.map(() => 0);
  const mid = (min + max) / 2;
  const half = (max - min) / 2;
  return values.map((v) => (v - mid) / half);
}
