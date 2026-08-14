/**
 * Frequency limits and per-model traits for the FY series.
 *
 * FeelTech publishes no machine-readable limit table, and the PDFs quote a
 * single headline figure that is always the *sine* bandwidth — square and
 * arbitrary output roll off well below it. Rather than copy a number from a
 * catalogue and present it as authoritative, this module derives what it can
 * from what the device itself reports and leaves the rest `null`.
 *
 * The lever that makes this work: FY firmware answers `UMO` with a model string
 * that carries its own bandwidth marker — `FY6300-60M` is a 60 MHz unit,
 * `FY6900-100M` a 100 MHz one. That is the manufacturer's own figure, read off
 * the device in front of you, and it settles the variant problem that makes a
 * static table wrong: one model name covers 20/40/60/80/100 MHz builds.
 */

import {
  unknownLimits,
  type FrequencyLimits,
  type VerificationLevel,
} from "@freqgen/core";
import type { DeviceFamily } from "./types.js";

/**
 * Read the bandwidth marker off a reported model string.
 *
 * `"FY6300-60M"` → `60_000_000`. Returns `null` when the string carries no
 * marker (older firmware answers with a bare `"FY6300"`), which is reported as
 * unknown rather than filled in from a table.
 */
export function bandwidthFromModel(model: string): number | null {
  const m = /-(\d+(?:\.\d+)?)\s*M/i.exec(model.trim());
  if (!m) return null;
  const mhz = Number(m[1]);
  return Number.isFinite(mhz) && mhz > 0 ? mhz * 1e6 : null;
}

/**
 * Frequency limits for a device, given whatever it told us about itself.
 *
 * Only the sine figure is ever populated, and only when the model string
 * carries a marker. Square and arbitrary bandwidth stay `null`: they are the
 * figures that actually constrain square-wave work, they are lower than sine,
 * and FeelTech does not document them. `resolveCap()` from the core will offer
 * the sine figure as an explicitly-labelled ceiling when asked for square.
 */
export function limitsForModel(model: string): FrequencyLimits {
  const sineMax = bandwidthFromModel(model);
  const verified: VerificationLevel = sineMax != null ? "partial" : false;
  const note =
    sineMax != null
      ? `Sine maximum ${sineMax / 1e6} MHz read from the model string the device ` +
        "reported. Square and arbitrary bandwidth are lower and undocumented."
      : "The device reported no bandwidth marker in its model string, so no " +
        "limit is known. Set one explicitly if you know your unit's rating.";

  if (sineMax == null) {
    return unknownLimits(verified, note, ["UMO model string"]);
  }
  return {
    sine: { minHz: null, maxHz: sineMax },
    square: { minHz: null, maxHz: null },
    arbitrary: { minHz: null, maxHz: null },
    verified,
    note,
    sources: ["UMO model string"],
  };
}

/** Per-model traits that are not frequency limits. */
export interface FyModelTraits {
  /**
   * Channels this library can drive. The FY8300 is a three-channel instrument,
   * but only its main and auxiliary channels are implemented here.
   */
  channels: number;
  /**
   * Duty cycle only applies to certain waveform codes.
   *
   * On the FY6900 the manual is explicit: waveform 1 (Square) is fixed at 50 %
   * and silently ignores duty writes; duty only takes effect on waveform 2
   * (Rectangle). Callers that need a non-50 % duty must select Rectangle.
   */
  dutyGatedByWaveform: boolean;
}

/**
 * Traits for a reported model.
 *
 * Keyed on the model string rather than the protocol family, because the family
 * deliberately lumps FY6300/6600/6800/6900/8300 together — they share a wire
 * format but not these behaviours.
 */
export function traitsForModel(model: string, family: DeviceFamily): FyModelTraits {
  const m = model.toUpperCase();
  return {
    channels: 2,
    // Confirmed for the FY6900 only. The FY6300 in particular does not gate
    // duty this way, so do not widen this to the whole FY6900 protocol family.
    dutyGatedByWaveform: m.includes("FY69") && family !== "FY2300",
  };
}
