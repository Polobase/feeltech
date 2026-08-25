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

interface RawPreset {
  settings: Record<string, string>;
  programNames: string[];
  frequencyLines: string[];
}

/** Split preset text into its flat settings plus the repeated program lines. */
function parsePresetRaw(text: string): RawPreset {
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

  return { settings, programNames, frequencyLines };
}

function buildPreset(raw: RawPreset): Spooky2Preset {
  const programs: PresetProgram[] = raw.programNames.map((name, i) => ({
    name,
    frequencies: parseFrequencyLine(raw.frequencyLines[i] ?? ""),
  }));
  return { name: raw.settings["PresetName"] ?? "", settings: raw.settings, programs };
}

/** Parse a Spooky2 preset file's text into a typed model (no inheritance). */
export function parsePreset(text: string): Spooky2Preset {
  return buildPreset(parsePresetRaw(text));
}

/**
 * Every waveform selection flag, per output. Spooky2 spells CH2's triangle
 * `Out_2_Triangle`; the rest are `Out<ch>_<name>`. A preset picks exactly one
 * waveform per output, so these behave as a radio group when merging.
 */
const WAVEFORM_FLAGS = [
  "Sine", "Square", "Sawtooth", "Inverted_Sawtooth", "Triangle",
  "Sine_Damped", "Square_Damped", "Sine_Hbomb", "Square_Hbomb",
  "User_Defined_1", "User_Defined_2",
] as const;

function waveformFlagKeys(channel: 1 | 2): string[] {
  return WAVEFORM_FLAGS.map((w) =>
    channel === 2 && w === "Triangle" ? "Out_2_Triangle" : `Out${channel}_${w}`,
  );
}

/**
 * Merge a base preset's settings with a child's overrides.
 *
 * A child that selects any waveform for an output clears the base's waveform
 * flags for that output first (they are a radio group — otherwise the base's
 * selection would survive alongside the child's).
 */
function mergeSettings(
  base: Record<string, string>,
  child: Record<string, string>,
): Record<string, string> {
  const out = { ...base };
  for (const channel of [1, 2] as const) {
    const keys = waveformFlagKeys(channel);
    if (keys.some((k) => child[k] === "True")) for (const k of keys) delete out[k];
  }
  return { ...out, ...child };
}

export interface ResolvePresetOptions {
  /**
   * Directory that ends the `Preset Collections` tree. `Base_Preset` paths are
   * Windows-style and relative to it. Defaults to the ancestor of `entryPath`
   * named `Preset Collections`.
   */
  presetCollectionsRoot?: string;
  /** Called with a non-fatal problem (missing/unrooted base). */
  onWarn?: (message: string) => void;
}

/**
 * Resolve a preset's `Base_Preset` inheritance chain into one merged preset.
 *
 * Real presets are thin: `Acholeplasma (DNA) (R) - JW` is nine lines whose
 * `Out2_Hz_Factor`, `Out1_Offset`, active waveform and per-waveform WCM all live
 * in the base shell it points at. This follows that chain, merging child over
 * base, so {@link presetToProgram} and {@link GenXPro.loadPreset} see the whole
 * picture.
 *
 * `readText(path)` reads a preset file and throws if it is missing — injected so
 * this stays browser-safe and unit-testable (the CLI passes `fs.readFileSync`).
 * The child's frequency programs win; only settings are inherited.
 */
export function resolvePresetChain(
  entryPath: string,
  readText: (path: string) => string,
  options: ResolvePresetOptions = {},
): Spooky2Preset {
  const resolve = (filePath: string, seen: Set<string>): RawPreset => {
    if (seen.has(filePath)) {
      throw new Error(`circular Base_Preset at ${filePath}`);
    }
    seen.add(filePath);

    const raw = parsePresetRaw(readText(filePath));
    const base = raw.settings["Base_Preset"];
    if (!base) return raw;

    const basePath = resolveBasePath(filePath, base, options.presetCollectionsRoot);
    if (basePath === null) {
      options.onWarn?.(`cannot resolve Base_Preset (no "Preset Collections" root): ${base}`);
      return raw;
    }
    let baseRaw: RawPreset;
    try {
      baseRaw = resolve(readableBasePath(basePath, readText), seen);
    } catch (err) {
      if (err instanceof Error && /circular/.test(err.message)) throw err;
      options.onWarn?.(`Base_Preset not found, using overrides only: ${basePath}`);
      return raw;
    }
    return {
      settings: mergeSettings(baseRaw.settings, raw.settings),
      // Child frequencies win; fall back to the base's if the child has none.
      programNames: raw.programNames.length ? raw.programNames : baseRaw.programNames,
      frequencyLines: raw.programNames.length ? raw.frequencyLines : baseRaw.frequencyLines,
    };
  };

  return buildPreset(resolve(entryPath, new Set()));
}

/** Join a Windows-style `Base_Preset` path onto the Preset Collections root. */
function resolveBasePath(
  entryPath: string,
  base: string,
  rootOverride: string | undefined,
): string | null {
  const marker = "Preset Collections";
  const norm = entryPath.replace(/\\/g, "/");
  const root = rootOverride ?? (() => {
    const idx = norm.indexOf(marker);
    return idx === -1 ? null : norm.slice(0, idx + marker.length);
  })();
  if (root === null) return null;
  const rel = base.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${root.replace(/\/+$/, "")}/${rel}`;
}

/** Base paths omit the `.txt` extension; find the form the reader can open. */
function readableBasePath(basePath: string, readText: (path: string) => string): string {
  try {
    readText(basePath);
    return basePath;
  } catch {
    const withExt = `${basePath}.txt`;
    readText(withExt); // throws if this is missing too — caught by the caller
    return withExt;
  }
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
 * In radionics/spectrum presets a single stores its frequency as `base × wcm`,
 * where `wcm` is the **active waveform's** wave-cycle multiplier
 * (`Out1_Sine=True` → `Sine_WCM`). Such a single is decoded back to `freq ÷ wcm`
 * (`396=11` → 36 Hz). Any other single is a plain frequency with a dwell in
 * seconds and is kept as-is (`7.83=600` → 7.83 Hz, dwell 600) — matching only
 * the active WCM (and only when it is > 1) avoids mistaking a dwell that happens
 * to equal an unrelated WCM for a radionics multiplier.
 */
export function presetProgramsForUpload(
  preset: Spooky2Preset,
): Array<{ name: string; frequenciesHz: number[]; dwell: number }> {
  const wcm = activeWaveformWcm(preset.settings);
  const decode = (f: PresetFrequency) =>
    wcm > 1 && f.dwellOrWcm === wcm ? f.hz / f.dwellOrWcm : f.hz;
  return preset.programs
    .map((program) => ({
      name: program.name,
      dwell: program.frequencies[0]?.dwellOrWcm ?? 180,
      frequenciesHz: program.frequencies
        .filter((f) => f.dna === null && f.endHz === null)
        .map(decode),
    }))
    .filter((program) => program.frequenciesHz.length > 0);
}

/**
 * The wave-cycle multiplier of the preset's active waveform.
 *
 * The active waveform is the one whose `Out1_<name>=True` flag is set; its
 * multiplier is `<name>_WCM` (`Sine`→`Sine_WCM`, `Square_Damped`→
 * `Square_Damped_WCM`). Waveforms without a `_WCM` key (sawtooth, triangle)
 * and an unset/≤1 multiplier return 1 — i.e. no radionics multiplication.
 */
export function activeWaveformWcm(settings: Record<string, string>): number {
  for (const flag of WAVEFORM_FLAGS) {
    if (settings[`Out1_${flag}`] === "True") {
      return numSetting(settings, `${flag}_WCM`, 1);
    }
  }
  return 1;
}

/** Read a numeric setting, treating absent/blank/non-numeric as the fallback. */
function numSetting(
  settings: Record<string, string>,
  key: string,
  fallback: number,
): number {
  const raw = settings[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
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

/** One output channel to drive: amplitude, DC offset, waveform and its
 * frequency relationship to the program frequency. */
export interface PresetOutput {
  /** Channel index (0 = Out 1, 1 = Out 2). */
  channel: number;
  /** Amplitude in volts peak-to-peak. */
  amplitudeVpp: number;
  /** DC offset in volts. */
  offsetV: number;
  waveform: WaveformKind;
  /**
   * This output's frequency is `programFrequency × freqFactor + freqConstant`.
   * Out 1 uses `Frequency_Multiplier`/`Frequency_Constant`; Out 2 composes those
   * with `Out2_Hz_Factor`/`Out2_Hz_Constant` (the DNA octave is factor 64, a
   * fixed Out 2 is factor 0 with the frequency in the constant).
   */
  freqFactor: number;
  freqConstant: number;
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
 *   (`396=11` → 36 Hz for 11 s), where `wcm` is the active waveform's multiplier.
 * - Standard single `freq=dwell` → `freq` Hz held for `dwell` seconds.
 * - DNA `~…` entries are skipped (decode not implemented) and reported.
 *
 * Amplitude comes from `Out1_Amplitude`/`Out2_Amplitude`; the DC offset is the
 * preset's percentage converted to volts (`offset% / 100 × Vpp / 2`). Each
 * output's frequency relationship (`freqFactor`/`freqConstant`) is read too, so
 * `Out 2 = Out 1 × factor + constant` runs correctly (see {@link PresetOutput}).
 */
export function presetToProgram(
  preset: Spooky2Preset,
  options: PresetRunOptions = {},
): PresetRun {
  const s = preset.settings;
  const wcm = activeWaveformWcm(s);
  const sweepSteps = options.sweepSteps ?? DEFAULT_SWEEP_STEPS;
  const waveform = options.waveform ?? waveformFromSettings(s);
  const warnings: string[] = [];

  const freqMultiplier = numSetting(s, "Frequency_Multiplier", 1);
  const freqConstant = numSetting(s, "Frequency_Constant", 0);
  const out2Factor = numSetting(s, "Out2_Hz_Factor", 1);
  const out2Constant = numSetting(s, "Out2_Hz_Constant", 0);

  const channels = options.channels ?? [0, 1];
  const outputs: PresetOutput[] = channels.map((channel) => {
    const isOut1 = channel === 0;
    const amplitudeVpp = numSetting(s, isOut1 ? "Out1_Amplitude" : "Out2_Amplitude", 20);
    const offsetPct = numSetting(s, isOut1 ? "Out1_Offset" : "Out2_Offset", 0);
    const offsetV = (offsetPct / 100) * (amplitudeVpp / 2);
    if (Math.abs(offsetV) >= amplitudeVpp / 2 && offsetPct !== 0) {
      warnings.push(
        `channel ${channel} offset ${offsetV.toFixed(2)} V consumes the full ` +
          `${amplitudeVpp} Vpp swing and will clip`,
      );
    }
    // Out 2 composes the global transform with its own factor/constant.
    const freqFactor = isOut1 ? freqMultiplier : freqMultiplier * out2Factor;
    const freqConst = isOut1 ? freqConstant : freqConstant * out2Factor + out2Constant;
    return { channel, amplitudeVpp, offsetV, waveform, freqFactor, freqConstant: freqConst };
  });

  const segments: PresetSegment[] = [];
  for (const program of preset.programs) {
    for (const f of program.frequencies) {
      if (f.dna !== null) {
        warnings.push(`skipped DNA frequency ~${f.dna} (decode not implemented)`);
        continue;
      }
      if (f.endHz !== null) {
        const rangeWcm = f.dwellOrWcm;
        segments.push({
          type: "sweep",
          startHz: f.hz / rangeWcm,
          endHz: f.endHz / rangeWcm,
          steps: sweepSteps,
          dwellPerStepSeconds: rangeWcm / sweepSteps,
        });
        continue;
      }
      const isRadionics = wcm > 1 && f.dwellOrWcm === wcm;
      segments.push({
        type: "step",
        frequencyHz: isRadionics ? f.hz / f.dwellOrWcm : f.hz,
        dwellSeconds: f.dwellOrWcm,
      });
    }
  }

  return { name: preset.name, outputs, segments, warnings };
}

/**
 * Read the waveform the preset requests from its `Out1_<name>=True` flags,
 * mapped to the vendor-neutral {@link WaveformKind} vocabulary. Shapes without a
 * generic equivalent (the damped and H-bomb variants) fall back to their base
 * shape; the default is sine.
 */
function waveformFromSettings(settings: Record<string, string>): WaveformKind {
  const on = (name: string) => settings[`Out1_${name}`] === "True";
  if (on("Sine") || on("Sine_Damped") || on("Sine_Hbomb")) return "sine";
  if (on("Square") || on("Square_Damped") || on("Square_Hbomb")) return "square";
  if (on("Sawtooth")) return "ramp-up";
  if (on("Inverted_Sawtooth")) return "ramp-down";
  if (on("Triangle")) return "triangle";
  return "sine";
}