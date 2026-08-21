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