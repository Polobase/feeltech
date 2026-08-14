import { substituteWaveform } from "@freqgen/core";
import type { AppliedWaveform, WaveformKind } from "@freqgen/core";
import type { Channel } from "./types.js";
import type { WaveformDescriptor } from "./types.js";

/**
 * FY2300 waveform table. Same list for both main (WMW) and auxiliary (WFW) channels.
 * Codes 0–30 are built-in, 31–46 are arbitrary waveform slots 1–16.
 */
export const FY2300_WAVEFORMS: readonly string[] = [
  "Sine",
  "Rectangular",
  "Triangle/Square",
  "Rise Sawtooth",
  "Fall Sawtooth",
  "Step Triangle",
  "Positive Step",
  "Inverse Step",
  "Positive Exponent",
  "Inverse Exponent",
  "Positive Falling Exponent",
  "Inverse Falling Exponent",
  "Positive Logarithm",
  "Inverse Logarithm",
  "Positive Falling Logarithm",
  "Inverse Falling Logarithm",
  "Positive Half Wave",
  "Negative Half Wave",
  "Positive Half Wave Rectification",
  "Negative Half Wave Rectification",
  "Lorenz Pulse",
  "Multitone",
  "Noise",
  "ECG",
  "Trapezoidal Pulse",
  "Sinc Pulse",
  "Narrow Pulse",
  "Gauss White Noise",
  "AM",
  "FM",
  "Linear FM",
];

export const FY2300_ARBITRARY_BASE = 31;
export const FY2300_ARBITRARY_COUNT = 16;

/**
 * FY6900 main channel (WMW/RMW). Codes 0–36 built-in, 37–99 arbitrary 1–64.
 */
export const FY6900_MAIN_WAVEFORMS: readonly string[] = [
  "Sine",
  "Square",
  "Rectangle",
  "Trapezoid",
  "CMOS",
  "Adj-Pulse",
  "DC",
  "Triangle",
  "Ramp",
  "NegRamp",
  "StairTriangle",
  "Stairstep",
  "NegStair",
  "PosExponent",
  "NegExponent",
  "P-Fall-Exp",
  "N-Fall-Exp",
  "PosLogarithm",
  "NegLogarithm",
  "P-Fall-Log",
  "N-Fall-Log",
  "P-Full-Wav",
  "N-Full-Wav",
  "P-Half-Wav",
  "N-Half-Wav",
  "Lorentz-Pulse",
  "Multitone",
  "Random-Noise",
  "ECG",
  "Trapezoid2",
  "Sinc-Pulse",
  "Impulse",
  "AWGN",
  "AM",
  "FM",
  "Chirp",
  "Impulse2",
];

/**
 * FY6900 auxiliary channel (WFW/RFW). Adj-Pulse is missing on CH2,
 * shifting all subsequent codes by −1.
 * Codes 0–35 built-in, 36–98 arbitrary 1–64.
 */
export const FY6900_AUX_WAVEFORMS: readonly string[] = [
  "Sine",
  "Square",
  "Rectangle",
  "Trapezoid",
  "CMOS",
  "DC",
  "Triangle",
  "Ramp",
  "NegRamp",
  "StairTriangle",
  "Stairstep",
  "NegStair",
  "PosExponent",
  "NegExponent",
  "P-Fall-Exp",
  "N-Fall-Exp",
  "PosLogarithm",
  "NegLogarithm",
  "P-Fall-Log",
  "N-Fall-Log",
  "P-Full-Wav",
  "N-Full-Wav",
  "P-Half-Wav",
  "N-Half-Wav",
  "Lorentz-Pulse",
  "Multitone",
  "Random-Noise",
  "ECG",
  "Trapezoid2",
  "Sinc-Pulse",
  "Impulse",
  "AWGN",
  "AM",
  "FM",
  "Chirp",
  "Impulse2",
];

export const FY6900_MAIN_ARBITRARY_BASE = 37;
export const FY6900_AUX_ARBITRARY_BASE = 36;
export const FY6900_ARBITRARY_COUNT = 64;

/** Look up a waveform name from a numeric code. */
export function waveformName(
  family: "FY2300" | "FY6900" | "Unknown",
  channel: Channel,
  code: number,
): string {
  if (family === "FY2300") {
    if (code >= 0 && code < FY2300_WAVEFORMS.length) {
      return FY2300_WAVEFORMS[code]!;
    }
    if (
      code >= FY2300_ARBITRARY_BASE &&
      code < FY2300_ARBITRARY_BASE + FY2300_ARBITRARY_COUNT
    ) {
      return `Arbitrary${code - FY2300_ARBITRARY_BASE + 1}`;
    }
    return `Unknown(${code})`;
  }

  // FY6900 (and compatible FY63xx/68xx/83xx).
  const table = channel === 0 ? FY6900_MAIN_WAVEFORMS : FY6900_AUX_WAVEFORMS;
  const arbBase =
    channel === 0 ? FY6900_MAIN_ARBITRARY_BASE : FY6900_AUX_ARBITRARY_BASE;
  if (code >= 0 && code < table.length) return table[code]!;
  if (code >= arbBase && code < arbBase + FY6900_ARBITRARY_COUNT) {
    return `Arbitrary${code - arbBase + 1}`;
  }
  return `Unknown(${code})`;
}

/** List all waveforms available on a given family/channel. */
export function listWaveforms(
  family: "FY2300" | "FY6900" | "Unknown",
  channel: Channel,
): WaveformDescriptor[] {
  const out: WaveformDescriptor[] = [];
  if (family === "FY2300") {
    FY2300_WAVEFORMS.forEach((name, code) => out.push({ code, name }));
    for (let i = 0; i < FY2300_ARBITRARY_COUNT; i++) {
      out.push({
        code: FY2300_ARBITRARY_BASE + i,
        name: `Arbitrary${i + 1}`,
        arbitrary: true,
        arbitrarySlot: i + 1,
      });
    }
    return out;
  }
  const table = channel === 0 ? FY6900_MAIN_WAVEFORMS : FY6900_AUX_WAVEFORMS;
  const arbBase =
    channel === 0 ? FY6900_MAIN_ARBITRARY_BASE : FY6900_AUX_ARBITRARY_BASE;
  table.forEach((name, code) => out.push({ code, name }));
  for (let i = 0; i < FY6900_ARBITRARY_COUNT; i++) {
    out.push({
      code: arbBase + i,
      name: `Arbitrary${i + 1}`,
      arbitrary: true,
      arbitrarySlot: i + 1,
    });
  }
  return out;
}

/**
 * Resolve a waveform input (number, name, or "Arbitrary<n>") to a numeric code.
 * Throws if the waveform name is not recognized.
 */
export function resolveWaveform(
  family: "FY2300" | "FY6900" | "Unknown",
  channel: Channel,
  input: number | string,
): number {
  if (typeof input === "number") return input;

  // "Arbitrary1" .. "Arbitrary64"
  const arbMatch = /^arbitrary\s*(\d+)$/i.exec(input);
  if (arbMatch) {
    const slot = Number(arbMatch[1]);
    if (family === "FY2300") {
      if (slot < 1 || slot > FY2300_ARBITRARY_COUNT) {
        throw new Error(`FY2300 has slots 1..${FY2300_ARBITRARY_COUNT}`);
      }
      return FY2300_ARBITRARY_BASE + slot - 1;
    }
    if (slot < 1 || slot > FY6900_ARBITRARY_COUNT) {
      throw new Error(`FY6900 has slots 1..${FY6900_ARBITRARY_COUNT}`);
    }
    const base =
      channel === 0 ? FY6900_MAIN_ARBITRARY_BASE : FY6900_AUX_ARBITRARY_BASE;
    return base + slot - 1;
  }

  const table =
    family === "FY2300"
      ? FY2300_WAVEFORMS
      : channel === 0
        ? FY6900_MAIN_WAVEFORMS
        : FY6900_AUX_WAVEFORMS;
  const norm = input.trim().toLowerCase();
  const idx = table.findIndex((n) => n.toLowerCase() === norm);
  if (idx === -1) {
    throw new Error(`Unknown waveform "${input}" for ${family} channel ${channel}`);
  }
  return idx;
}

/**
 * Generic {@link WaveformKind} → FY waveform *name* per family.
 *
 * Names rather than codes on purpose: `resolveWaveform()` already knows the
 * per-channel code tables, including the CH2 offset caused by the missing
 * Adj-Pulse entry, so going through it keeps one source of truth for the
 * numbering. `null` means the family has no equivalent at all.
 */
const FY6900_KIND_NAMES: Readonly<Record<WaveformKind, string | null>> = {
  sine: "Sine",
  square: "Square",
  triangle: "Triangle",
  "ramp-up": "Ramp",
  "ramp-down": "NegRamp",
  dc: "DC",
  noise: "Random-Noise",
  custom: "Arbitrary1",
};

const FY2300_KIND_NAMES: Readonly<Record<WaveformKind, string | null>> = {
  sine: "Sine",
  square: "Rectangular",
  triangle: "Triangle/Square",
  "ramp-up": "Rise Sawtooth",
  "ramp-down": "Fall Sawtooth",
  // The FY2300 table has no constant-level entry.
  dc: null,
  noise: "Noise",
  custom: "Arbitrary1",
};

function kindNames(
  family: "FY2300" | "FY6900" | "Unknown",
): Readonly<Record<WaveformKind, string | null>> {
  return family === "FY2300" ? FY2300_KIND_NAMES : FY6900_KIND_NAMES;
}

/** Generic waveform kinds this family can produce natively. */
export function supportedKinds(
  family: "FY2300" | "FY6900" | "Unknown",
): readonly WaveformKind[] {
  const names = kindNames(family);
  return (Object.keys(names) as WaveformKind[]).filter((k) => names[k] !== null);
}

/**
 * Resolve a generic waveform kind to an FY code, substituting the closest
 * available shape when the family has no direct equivalent.
 *
 * Returns the substitution decision rather than applying it silently, so a
 * caller can warn or refuse. On the FY series only `dc` on the FY2300 needs
 * substituting; the flag matters more for other vendors.
 */
export function resolveWaveformKind(
  family: "FY2300" | "FY6900" | "Unknown",
  channel: Channel,
  kind: WaveformKind,
): AppliedWaveform {
  const names = kindNames(family);
  const direct = names[kind];
  if (direct !== null) {
    return {
      requested: kind,
      actual: kind,
      substituted: false,
      code: resolveWaveform(family, channel, direct),
    };
  }
  const actual = substituteWaveform(kind, supportedKinds(family));
  if (actual === undefined) {
    throw new Error(
      `No ${family} waveform can stand in for "${kind}" on channel ${channel}`,
    );
  }
  return {
    requested: kind,
    actual,
    substituted: true,
    code: resolveWaveform(family, channel, names[actual]!),
  };
}

/**
 * Best-effort reverse of {@link resolveWaveformKind}: which generic kind does
 * this FY code correspond to?
 *
 * Used when a caller asks in device terms (a numeric code or an FY name) and we
 * still owe them an {@link AppliedWaveform}. Codes with no generic equivalent —
 * most of the FY table — report as `"custom"`, which is accurate: they are
 * shapes the vendor-neutral vocabulary cannot name.
 */
export function kindForCode(
  family: "FY2300" | "FY6900" | "Unknown",
  channel: Channel,
  code: number,
): WaveformKind {
  const names = kindNames(family);
  for (const kind of Object.keys(names) as WaveformKind[]) {
    const name = names[kind];
    if (name === null || kind === "custom") continue;
    if (resolveWaveform(family, channel, name) === code) return kind;
  }
  return "custom";
}
