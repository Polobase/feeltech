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
