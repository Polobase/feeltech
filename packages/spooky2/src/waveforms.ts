/**
 * The Spooky2 waveform tables.
 *
 * These are the actual sample tables the Spooky2 application uploads, taken
 * verbatim from its `Data/Waveforms.csv` (1024 samples, normalised to −1…+1).
 * The column-to-name mapping was established by shape and cross-checked against
 * the waveform flags in Spooky2 preset files (`Out1_Sine`, `Out1_Square`,
 * `Out1_Sawtooth`, `Out1_Sine_Damped`, `Out1_Sine_Hbomb`, `Out1_User_Defined_1`,
 * and so on).
 *
 * The two user-defined slots are whatever the source installation had loaded
 * (`Alpha-Stim` here); treat them as examples, not fixed shapes.
 *
 * These are the *shapes*. Uploading one to a device is a separate concern — the
 * Gen X waveform registers (`:w20`/`:w21`) select a built-in slot by number, and
 * how (or whether) a custom table can be pushed to generator memory is not yet
 * established for these devices.
 */

import data from "./waveform-data.json" with { type: "json" };

/** Number of samples per waveform. */
export const SPOOKY2_WAVEFORM_SAMPLES: number = data.samples;

/** The Spooky2 waveform names, in preset-flag order. */
export type Spooky2WaveformName = keyof typeof data.waveforms;

/**
 * Sample tables by name, each `SPOOKY2_WAVEFORM_SAMPLES` values in −1…+1.
 *
 * ```ts
 * import { SPOOKY2_WAVEFORMS } from "@freqgen/spooky2";
 * const sineDamped = SPOOKY2_WAVEFORMS.sineDamped; // number[]
 * ```
 */
export const SPOOKY2_WAVEFORMS: Readonly<Record<Spooky2WaveformName, readonly number[]>> =
  data.waveforms;

/** Names of every shipped waveform. */
export const SPOOKY2_WAVEFORM_NAMES = Object.keys(
  data.waveforms,
) as Spooky2WaveformName[];

/** Look up a waveform's samples by name, or `undefined` if unknown. */
export function spooky2Waveform(name: string): readonly number[] | undefined {
  return (SPOOKY2_WAVEFORMS as Record<string, readonly number[]>)[name];
}
