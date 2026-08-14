/**
 * Low-level protocol encoding & decoding for the FY series.
 *
 * Reference: docs/serial_protocol.md (FY2300 Rev 1.2, FY6900 Rev 1.8).
 */

import type { DeviceFamily, FrequencyEncoding } from "./types.js";

/** Command terminator used by all FY series devices. */
export const TERMINATOR = "\n";

/**
 * Pad an unsigned integer to a fixed width with leading zeros.
 */
export function padInt(value: number | bigint, width: number): string {
  const s = typeof value === "bigint" ? value.toString() : Math.trunc(value).toString();
  if (s.length >= width) return s;
  return s.padStart(width, "0");
}

/**
 * Encode a frequency in Hz for the WMF/WFF set commands.
 *
 * - FY2300: 14-digit µHz integer (e.g. 10 kHz -> "00010000000000")
 * - FY6900 family: %015.6f Hz with leading zeros (e.g. 10 kHz -> "00010000.000000")
 *
 * `encoding` overrides the family default — some older FY6900 firmware
 * revisions expect the 14-digit µHz form instead of decimal Hz.
 */
export function encodeFrequencyHz(
  family: DeviceFamily,
  hz: number,
  encoding?: FrequencyEncoding,
): string {
  const enc = encoding ?? (family === "FY2300" ? "uHz" : "hz");
  if (enc === "uHz") {
    const microHz = BigInt(Math.round(hz * 1_000_000));
    return padInt(microHz, 14);
  }
  // FY6900 / FY6300 / FY8300 family: 15 chars, "00000000.000000"
  const fixed = hz.toFixed(6);
  return fixed.padStart(15, "0");
}

/**
 * Decode a frequency response from RMF/RFF.
 *
 * - FY2300: integer Hz
 * - FY6900: decimal Hz (e.g. "00010000.000000" -> 10000)
 */
export function decodeFrequencyHz(family: DeviceFamily, raw: string): number {
  const trimmed = raw.trim();
  if (family === "FY2300") {
    return Number(trimmed.replace(/^0+(?=\d)/, "") || "0");
  }
  return Number(trimmed);
}

/**
 * Encode amplitude in volts for WMA/WFA.
 *
 * - FY2300: 2 decimals (internal scale: V × 100)
 * - FY6900 family: 4 decimals (internal scale: V × 10000)
 */
export function encodeAmplitudeV(family: DeviceFamily, volts: number): string {
  return volts.toFixed(family === "FY2300" ? 2 : 4);
}

/**
 * Decode amplitude integer response.
 *
 * Empirically confirmed against an FY6300-60M:
 *   set 1.000 V → returns "10000"     → /10000 = 1.000 V
 *   set 3.300 V → returns "33000"     → /10000 = 3.300 V
 *   set 0.100 V → returns "1000"      → /10000 = 0.100 V
 *
 * The FY6900 protocol PDF Rev 1.8 example claims `/1000`, but real firmware
 * (FY6300/6900) uses `/10000`. The fygen library uses `/10000` as well.
 */
export function decodeAmplitudeV(family: DeviceFamily, raw: string): number {
  const n = Number(raw.trim());
  return family === "FY2300" ? n / 100 : n / 10000;
}

/**
 * Encode signed offset voltage for WMO/WFO. The protocol accepts a literal
 * signed decimal (e.g. "-2.351").
 */
export function encodeOffsetV(family: DeviceFamily, volts: number): string {
  return volts.toFixed(family === "FY2300" ? 2 : 3);
}

/**
 * Decode offset reading.
 *
 * - FY2300: bias of 1000, scale 1/100.
 *     raw < 1000 → −(1000 − raw)/100
 *     raw > 1000 →  (raw − 1000)/100
 *
 * - FY6900 family: signed 32-bit integer ÷ 1000.
 *   Values ≥ 2³¹ wrap to negative; e.g. raw `4294966062` represents −1234,
 *   yielding −1.234 V. The FY6900 PDF describes a 10000-bias formula but real
 *   firmware (FY6300/6900) uses two's-complement instead.
 */
export function decodeOffsetV(family: DeviceFamily, raw: string): number {
  const n = Number(raw.trim());
  if (family === "FY2300") {
    if (n === 1000) return 0;
    return n > 1000 ? (n - 1000) / 100 : -(1000 - n) / 100;
  }
  const signed = n >= 0x80000000 ? n - 0x100000000 : n;
  return signed / 1000;
}

/** Encode duty cycle 0..100 (with 1 decimal) for WMD/WFD. */
export function encodeDutyPct(pct: number): string {
  return pct.toFixed(1);
}

/**
 * Decode duty cycle response.
 *
 * - FY2300: raw / 10 = percent (e.g. 689 → 68.9%)
 * - FY6900 family: raw / 1000 = percent (e.g. 50000 → 50.0%)
 */
export function decodeDutyPct(family: DeviceFamily, raw: string): number {
  const n = Number(raw.trim());
  return family === "FY2300" ? n / 10 : n / 1000;
}

/**
 * Decode the frequency counter's measured duty cycle (RCD).
 *
 * Unlike the channel duty readback (RMD/RFD), the counter reports
 * raw / 10 = percent on all families (e.g. 668 → 66.8%).
 */
export function decodeCounterDutyPct(raw: string): number {
  return Number(raw.trim()) / 10;
}

/** Encode phase in degrees for WMP/WFP. */
export function encodePhaseDeg(family: DeviceFamily, degrees: number): string {
  // FY2300 stores integer degrees. FY6900 family accepts up to 3 decimals.
  return family === "FY2300"
    ? Math.round(degrees).toString()
    : degrees.toFixed(3);
}

/**
 * Decode phase reading.
 *
 * - FY2300: integer degrees
 * - FY6900 family: raw / 1000 = degrees (e.g. 90000 → 90.000°)
 */
export function decodePhaseDeg(family: DeviceFamily, raw: string): number {
  const n = Number(raw.trim());
  return family === "FY2300" ? n : n / 1000;
}

/**
 * Decode a boolean status response. FY devices respond with 0=off, 255=on for output enable
 * and many flags. Some firmwares respond with 1 instead of 255 — we treat any non-zero as true.
 */
export function decodeBool(raw: string): boolean {
  const t = raw.trim();
  return t.length > 0 && t !== "0" && t !== "0000000000";
}

/** Decode an integer response, stripping leading zeros. */
export function decodeInt(raw: string): number {
  return Number(raw.trim());
}

/** Strip the trailing newline & whitespace from a raw response. */
export function cleanResponse(raw: string): string {
  return raw.replace(/[\r\n]+$/g, "").trim();
}

/**
 * Build a complete command line (with trailing 0x0a).
 */
export function buildCommand(code: string, value: string | number = ""): string {
  const v = typeof value === "number" ? String(value) : value;
  return `${code}${v}${TERMINATOR}`;
}
