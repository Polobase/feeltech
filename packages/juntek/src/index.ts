/**
 * `@freqgen/juntek` — drivers for JUNTEK and Koolertron signal generators.
 *
 * ```ts
 * import { NodeSerialTransport } from "@freqgen/core/node";
 * import { Jds6600 } from "@freqgen/juntek";
 *
 * const gen = new Jds6600(new NodeSerialTransport("/dev/cu.usbserial-1120"));
 * await gen.open();
 * await gen.applyStep(0, {
 *   waveform: "square",
 *   frequencyHz: 1000,
 *   amplitudeVpp: 5,
 *   output: true,
 * });
 * ```
 *
 * Koolertron is a reseller brand rather than a manufacturer, which is why both
 * makes live in one package: the CJDS66 is a rebadged JDS6600 and speaks the
 * same registers, and the MHS-5200A is MHINSTEK/JUNTEK hardware.
 *
 * **No driver here has been verified against hardware.** Each reports
 * `capabilities.limits.verified === false`; confirm output with a scope.
 */

export { Jds6600, JDS_REGISTERS } from "./jds6600.js";
export type { Jds6600Options, JdsModel } from "./jds6600.js";

export { Mhs5200a, MHS_COMMANDS } from "./mhs5200a.js";
export type { Mhs5200aOptions } from "./mhs5200a.js";

export { JUNTEK_DEVICES } from "./devices.js";
