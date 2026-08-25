/**
 * Public API for the `feeltech` library.
 *
 * High-level usage (Node):
 *
 * ```ts
 * import { connectNode, Channel } from "feeltech";
 *
 * const fy = await connectNode("/dev/cu.wchusbserial110");
 * await fy.setWaveform(Channel.Main, "Sine");
 * await fy.setFrequency(Channel.Main, 1000);
 * await fy.setAmplitude(Channel.Main, 3.3);
 * await fy.setOutput(Channel.Main, true);
 * await fy.close();
 * ```
 *
 * High-level usage (Browser):
 *
 * ```ts
 * import { connectWeb, Channel } from "feeltech";
 *
 * const fy = await connectWeb();   // prompts user to pick a port
 * await fy.setFrequency(Channel.Main, 1000);
 * ```
 */

export { FeelTech, Channel, assertFamily } from "./feeltech.js";
export {
  ModulationMode,
  ModulationSource,
  SweepObject,
  SweepMode,
  SweepSource,
  GateTime,
  CouplingMode,
  Attenuation,
  SyncObject,
  CascadeRole,
  FeelTechError,
  FeelTechTimeoutError,
  FeelTechProtocolError,
  FeelTechVerifyError,
} from "./types.js";
export type {
  DeviceFamily,
  FrequencyEncoding,
  FeelTechOptions,
  ChannelState,
  MeasurementResult,
  SweepConfig,
  WaveformDescriptor,
} from "./types.js";

export type { Transport, SerialOpenOptions } from "@freqgen/core";

export {
  FY2300_WAVEFORMS,
  FY6900_MAIN_WAVEFORMS,
  FY6900_AUX_WAVEFORMS,
  listWaveforms,
  waveformName,
  resolveWaveform,
  resolveWaveformKind,
  supportedKinds,
  kindForCode,
} from "./waveforms.js";

export { bandwidthFromModel, limitsForModel, traitsForModel } from "./limits.js";
export { FEELTECH_DEVICES } from "./devices.js";

export { FY3200S } from "./fy3200s.js";
export type { FY3200SOptions } from "./fy3200s.js";
export type { FyModelTraits } from "./limits.js";

/**
 * Vendor-neutral types from `@freqgen/core`, re-exported so code built on
 * `feeltech` can talk about generators generically without a second install.
 */
export {
  applyStepSequentially,
  substituteWaveform,
  foldToBand,
  fitFrequencies,
  resolveCap,
  unknownLimits,
  DEFAULT_CAPABILITIES,
} from "@freqgen/core";
export type {
  SignalGenerator,
  DeviceInfo,
  ChannelStep,
  WaveformKind,
  AppliedWaveform,
  Capabilities,
  FrequencyLimits,
  FrequencyRange,
  LimitOverride,
  ResolvedCap,
  VerificationLevel,
  WaveformClass,
  Band,
  FoldResult,
  FitOptions,
  FitResult,
  FitStatus,
  FitWarning,
} from "@freqgen/core";

export { resampleWaveform, normalizeWaveform } from "./waveform-utils.js";

export {
  buildCommand,
  encodeFrequencyHz,
  decodeFrequencyHz,
  encodeAmplitudeV,
  decodeAmplitudeV,
  encodeOffsetV,
  decodeOffsetV,
  encodeDutyPct,
  decodeDutyPct,
  decodeCounterDutyPct,
  encodePhaseDeg,
  decodePhaseDeg,
} from "./protocol.js";

import { FeelTech } from "./feeltech.js";
import { FeelTechError, type FeelTechOptions } from "./types.js";

/**
 * Convenience helper: open a Node serial port and return a connected FeelTech instance.
 *
 * Requires the `serialport` peer dependency.
 *
 * When `path` is omitted, the port is auto-detected via {@link findDevices}
 * (USB serial adapters with a CH340/CP210x/PL2303 vendor ID). Exactly one
 * matching adapter must be present, otherwise a `FeelTechError` is thrown.
 *
 * @param path     Serial device path (e.g. "/dev/cu.wchusbserial1220" or "COM3"),
 *                 or `undefined` to auto-detect.
 * @param options  Optional FeelTech options.
 */
export async function connectNode(
  path?: string,
  options: FeelTechOptions = {},
): Promise<FeelTech> {
  const { NodeSerialTransport, findDevices } = await import("./transports/node.js");
  let resolvedPath = path;
  if (resolvedPath === undefined) {
    const candidates = await findDevices();
    if (candidates.length === 0) {
      throw new FeelTechError(
        "No FeelTech-like USB serial adapter found — pass the port path explicitly",
      );
    }
    if (candidates.length > 1) {
      throw new FeelTechError(
        `Multiple candidate ports found (${candidates.map((c) => c.path).join(", ")}) — pass the port path explicitly`,
      );
    }
    resolvedPath = candidates[0]!.path;
  }
  const transport = new NodeSerialTransport(resolvedPath);
  const fy = new FeelTech(transport, options);
  await fy.open();
  return fy;
}

/**
 * Convenience helper: prompt the user to pick a serial port via Web Serial,
 * open it, and return a connected FeelTech instance.
 *
 * Browser-only.
 */
export async function connectWeb(
  options: FeelTechOptions & {
    filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
  } = {},
): Promise<FeelTech> {
  const { WebSerialTransport } = await import("./transports/web.js");
  const transport = await WebSerialTransport.request(options.filters ?? []);
  const fy = new FeelTech(transport, options);
  await fy.open();
  return fy;
}

/**
 * USB vendor/product ID filters for the UART bridges these generators ship with
 * (CH340/CH341, CP210x, PL2303). Use with
 * `connectWeb({ filters: FEELTECH_USB_FILTERS })`.
 *
 * Now sourced from `@freqgen/core`, so it also covers CH341 and the
 * dual-port CP2105/CP2108 — a superset of the pre-0.2 list, meaning nothing
 * that matched before stops matching.
 */
export { USB_SERIAL_FILTERS as FEELTECH_USB_FILTERS } from "@freqgen/core";
