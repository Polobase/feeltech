/**
 * Spooky2 preset (.txt) parser.
 *
 * A preset file is a flat list of double-quoted `"Key=Value"` lines between
 * `[Preset]` and `[/Preset]`. Two keys are special — they repeat once per
 * program and carry the actual frequencies:
 *
 * ```
 * "Loaded_Programs=Ornithonyssus Bird Mite_1 (HC)"
 * "Loaded_Frequencies=877000=180,"
 * "Loaded_Frequencies=13703.12=180,2173.86=180,"
 * ```
 *
 * Frequency entries come in three forms:
 *
 * - `freq=dwell` — a single frequency held for `dwell` seconds
 *   (`877000=180`, `7.83=600`, `183.58=2700`).
 * - `start-end=wcm` — a range swept with wave-cycle multiplier `wcm`
 *   (`36-198=11`). Ranges are a *run-time* feature (the host sweeps the
 *   frequency register); they are not stored in offline program slots.
 * - `~<hex>` — a DNA-encoded frequency (`~6891BC97498`). The decode is
 *   Spooky2-proprietary and not yet reversed; the raw string is preserved.
 *
 * A fourth, radionics/spectrum-only form is a *single* whose value after `=`
 * matches the preset's wave-cycle multiplier (a `*_WCM` setting or a sibling
 * range's multiplier). There the frequency is stored as `base × wcm`
 * (`396=11` is really 36 Hz, `417=11` is 37.909… Hz), so the played frequency
 * is `freq ÷ wcm`. The parser keeps the raw value; {@link
 * presetProgramsForUpload} does the division.
 *
 * Everything else is a setting (`Out1_Amplitude=20`, `BFB_Start_Frequency=…`,
 * …) kept verbatim in {@link Spooky2Preset.settings}.
 */

import type { WaveformKind } from "@freqgen/core";

export interface PresetFrequency {
  /** Single frequency in Hz, or the start of a range. */
  hz: number;
  /** Range end in Hz, or `null` for a single frequency. */
  endHz: number | null;
  /**
   * The value after `=`: dwell in seconds for a single frequency, wave-cycle
   * multiplier for a range. Meaningless for DNA entries.
   */
  dwellOrWcm: number;
  /** Raw DNA string (without the `~`), when the entry is DNA-encoded. */
  dna: string | null;
}

export interface PresetProgram {
  /** Program name from `Loaded_Programs`. */
  name: string;
  /** Frequency entries from the matching `Loaded_Frequencies` line. */
  frequencies: PresetFrequency[];
}

export interface Spooky2Preset {
  /** `PresetName` value. */
  name: string;
  /** Every non-program key, verbatim. */
  settings: Record<string, string>;
  /** Programs, in file order. */
  programs: PresetProgram[];
}

/** Parse a Spooky2 preset file's text into a typed model. */
export function parsePreset(text: string): Spooky2Preset {
  const settings: Record<string, string> = {};
  const programNames: string[] = [];
  const frequencyLines: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('"') || !line.endsWith('"')) continue;
    const body = line.slice(1, -1);
    const eq = body.indexOf("=");
    if (eq < 0) continue;
    const key = body.slice(0, eq);
    const value = body.slice(eq + 1);
    if (key === "Loaded_Programs") programNames.push(value);
    else if (key === "Loaded_Frequencies") frequencyLines.push(value);
    else settings[key] = value;
  }

  const programs: PresetProgram[] = programNames.map((name, i) => ({
    name,
    frequencies: parseFrequencyLine(frequencyLines[i] ?? ""),
  }));

  return {
    name: settings["PresetName"] ?? "",
    settings,
    programs,
  };
}

/** Split a `Loaded_Frequencies` value into entries. */
export function parseFrequencyLine(line: string): PresetFrequency[] {
  return line
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(parseFrequencyEntry);
}

function parseFrequencyEntry(entry: string): PresetFrequency {
  if (entry.startsWith("~")) {
    return { hz: NaN, endHz: null, dwellOrWcm: 0, dna: entry.slice(1) };
  }
  const eq = entry.lastIndexOf("=");
  const value = Number(entry.slice(eq + 1));
  const freqPart = entry.slice(0, eq);
  const dash = freqPart.indexOf("-");
  if (dash > 0) {
    return {
      hz: Number(freqPart.slice(0, dash)),
      endHz: Number(freqPart.slice(dash + 1)),
      dwellOrWcm: value,
      dna: null,
    };
  }
  return { hz: Number(freqPart), endHz: null, dwellOrWcm: value, dna: null };
}

/**
 * The single-frequency programs of a preset, in the shape
 * {@link GenXPro.uploadProgram} expects.
 *
 * Range and DNA entries are excluded: ranges are run-time sweeps (see
 * {@link GenXPro.frequencySweep}), and DNA frequencies are not yet decodable.
 *
 * In radionics/spectrum presets a single stores its frequency as `base × wcm`
 * — the same multiplier as a `*_WCM` setting or a sibling range. Such a single
 * is decoded back to `freq ÷ wcm` (`396=11` → 36 Hz). A single whose value
 * matches no multiplier is a plain frequency with a dwell in seconds and is
 * kept as-is (`7.83=600` → 7.83 Hz, dwell 600).
 */
export function presetProgramsForUpload(
  preset: Spooky2Preset,
): Array<{ name: string; frequenciesHz: number[]; dwell: number }> {
  const wcms = spectrumWcmValues(preset);
  return preset.programs
    .map((program) => ({
      name: program.name,
      dwell: program.frequencies[0]?.dwellOrWcm ?? 180,
      frequenciesHz: program.frequencies
        .filter((f) => f.dna === null && f.endHz === null)
        .map((f) => (wcms.has(f.dwellOrWcm) ? f.hz / f.dwellOrWcm : f.hz)),
    }))
    .filter((program) => program.frequenciesHz.length > 0);
}

/**
 * The wave-cycle multipliers a preset uses: every `*_WCM` setting plus the
 * multiplier of every range entry (a range is always `start-end=wcm`).
 */
function spectrumWcmValues(preset: Spooky2Preset): Set<number> {
  const values = new Set<number>();
  for (const [key, raw] of Object.entries(preset.settings)) {
    if (key.endsWith("_WCM")) {
      const n = Number(raw);
      if (Number.isFinite(n)) values.add(n);
    }
  }
  for (const program of preset.programs) {
    for (const f of program.frequencies) {
      if (f.endHz !== null && Number.isFinite(f.dwellOrWcm)) values.add(f.dwellOrWcm);
    }
  }
  return values;
}

// ────────────────────────────────────────────────────────────────────────────
// Device-agnostic run model
// ────────────────────────────────────────────────────────────────────────────

/** A frequency sweep across a range, in linear steps. */
export interface SweepSegment {
  type: "sweep";
  startHz: number;
  endHz: number;
  /** Number of steps across the range. */
  steps: number;
  /** Hold time per step. Uniform — the whole sweep lasts `steps × dwell`. */
  dwellPerStepSeconds: number;
}

/** A single frequency held for a dwell. */
export interface StepSegment {
  type: "step";
  frequencyHz: number;
  dwellSeconds: number;
}

export type PresetSegment = SweepSegment | StepSegment;

/** One output channel to drive: amplitude, DC offset and waveform. */
export interface PresetOutput {
  /** Channel index (0 = Out 1, 1 = Out 2). */
  channel: number;
  /** Amplitude in volts peak-to-peak. */
  amplitudeVpp: number;
  /** DC offset in volts. */
  offsetV: number;
  waveform: WaveformKind;
}

/** A preset turned into a device-agnostic run plan. */
export interface PresetRun {
  /** `PresetName`. */
  name: string;
  /** Outputs to configure. */
  outputs: PresetOutput[];
  /** The frequency timeline, in order. */
  segments: PresetSegment[];
  /** Non-fatal problems (skipped DNA entries, clipping, …). */
  warnings: string[];
}

export interface PresetRunOptions {
  /** Linear steps per range sweep. Default 84 (the capture shows ~72–84 points
   * per range, varying with DDS quantization; this is a close, tunable default).
   * The dwell is scaled so the whole sweep still lasts `wcm` seconds. */
  sweepSteps?: number;
  /** Force a waveform instead of reading the preset's `Out1_*` flags. */
  waveform?: WaveformKind;
  /** Channels to drive. Default: 0 and 1. */
  channels?: number[];
}

const DEFAULT_SWEEP_STEPS = 84;

/**
 * Turn a parsed preset into a device-agnostic run plan.
 *
 * This is the *run-time* model, distinct from the offline upload path: ranges
 * become sweeps and radionics singles are decoded, matching what a Spooky2
 * capture shows the generator actually plays.
 *
 * - Range `start-end=wcm` → a linear sweep from `start/wcm` to `end/wcm`
 *   (`36-198=11` sweeps 3.27 → 18 Hz), lasting `wcm` seconds total
 *   (uniform `wcm/steps` dwell per step).
 * - Radionics single `freq=wcm` → `freq/wcm` Hz held for `wcm` seconds
 *   (`396=11` → 36 Hz for 11 s).
 * - Standard single `freq=dwell` → `freq` Hz held for `dwell` seconds.
 * - DNA `~…` entries are skipped (decode not implemented) and reported.
 *
 * Amplitude comes from `Out1_Amplitude`/`Out2_Amplitude`; the DC offset is the
 * preset's percentage converted to volts (`offset% / 100 × Vpp / 2`).
 */
export function presetToProgram(
  preset: Spooky2Preset,
  options: PresetRunOptions = {},
): PresetRun {
  const wcms = spectrumWcmValues(preset);
  const sweepSteps = options.sweepSteps ?? DEFAULT_SWEEP_STEPS;
  const waveform = options.waveform ?? waveformFromSettings(preset.settings);
  const warnings: string[] = [];

  const channels = options.channels ?? [0, 1];
  const outputs: PresetOutput[] = channels.map((channel) => {
    const ampKey = channel === 0 ? "Out1_Amplitude" : "Out2_Amplitude";
    const offKey = channel === 0 ? "Out1_Offset" : "Out2_Offset";
    const amplitudeVpp = Number(preset.settings[ampKey] ?? 20);
    const offsetPct = Number(preset.settings[offKey] ?? 0);
    const offsetV = (offsetPct / 100) * (amplitudeVpp / 2);
    if (Math.abs(offsetV) >= amplitudeVpp / 2) {
      warnings.push(
        `channel ${channel} offset ${offsetV.toFixed(2)} V consumes the full ` +
          `${amplitudeVpp} Vpp swing and will clip`,
      );
    }
    return { channel, amplitudeVpp, offsetV, waveform };
  });

  const segments: PresetSegment[] = [];
  for (const program of preset.programs) {
    for (const f of program.frequencies) {
      if (f.dna !== null) {
        warnings.push(`skipped DNA frequency ~${f.dna} (decode not implemented)`);
        continue;
      }
      if (f.endHz !== null) {
        const wcm = f.dwellOrWcm;
        segments.push({
          type: "sweep",
          startHz: f.hz / wcm,
          endHz: f.endHz / wcm,
          steps: sweepSteps,
          dwellPerStepSeconds: wcm / sweepSteps,
        });
        continue;
      }
      const isRadionics = wcms.has(f.dwellOrWcm);
      segments.push({
        type: "step",
        frequencyHz: isRadionics ? f.hz / f.dwellOrWcm : f.hz,
        dwellSeconds: f.dwellOrWcm,
      });
    }
  }

  return { name: preset.name, outputs, segments, warnings };
}

/** Read the waveform the preset requests from its `Out1_*` flags. */
function waveformFromSettings(settings: Record<string, string>): WaveformKind {
  if (settings["Out1_Sine"] === "True") return "sine";
  if (settings["Out1_Square"] === "True") return "square";
  if (settings["Out1_Triangle"] === "True") return "triangle";
  return "sine";
}