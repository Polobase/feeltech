/**
 * `@freqgen/spooky2` — drivers for Spooky2 signal generators.
 *
 * ```ts
 * import { NodeSerialTransport } from "@freqgen/core/node";
 * import { Spooky2XM } from "@freqgen/spooky2";
 *
 * const xm = new Spooky2XM(new NodeSerialTransport("/dev/cu.usbserial-1120"));
 * await xm.open();
 * await xm.applyStep(0, {
 *   waveform: "square",
 *   frequencyHz: 727.5,
 *   amplitudeVpp: 20,
 *   output: true,
 * });
 * ```
 *
 * ## Verification
 *
 * **None of these drivers has been checked against hardware.** They implement
 * protocols documented by third-party reverse engineering, and their tests
 * assert conformance to that documentation — which is not the same as proving
 * the documentation right. Every driver reports `capabilities.limits.verified
 * === false`. Confirm output with a scope before relying on any of it.
 *
 * The Gen X Pro additionally gates physical output behind a challenge/response
 * handshake, and this package ships no response algorithm. See
 * {@link AuthProvider}.
 */

export { Spooky2XM, XM_REGISTERS, XM_RANGE_BOUNDARY_HZ } from "./xm.js";
export type { Spooky2XmOptions } from "./xm.js";

export { GenXClassic, GENX_CLASSIC_REGISTERS } from "./genx-classic.js";
export type { GenXClassicOptions } from "./genx-classic.js";

export {
  GenXPro,
  GENX_PRO_REGISTERS,
  GENX_FREQ_SCALE_HIGH,
  GENX_FREQ_SCALE_LOW,
  GENX_FREQ_LOW_BOUNDARY_HZ,
  GENX_AMPLITUDE_SCALE,
} from "./genx-pro.js";
export type { GenXProOptions } from "./genx-pro.js";

export { GenXPair } from "./genx-pair.js";

export { generateNonce } from "./auth.js";
export type { AuthProvider, AuthChallenge } from "./auth.js";

export { amplitudeRegisterValue, channelSlot } from "./genx-wire.js";

export { SPOOKY2_DEVICES } from "./devices.js";

export {
  SPOOKY2_WAVEFORMS,
  SPOOKY2_WAVEFORM_NAMES,
  SPOOKY2_WAVEFORM_SAMPLES,
  spooky2Waveform,
} from "./waveforms.js";
export type { Spooky2WaveformName } from "./waveforms.js";
