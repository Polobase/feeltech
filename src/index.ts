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

export type { Transport, SerialOpenOptions } from "./transport.js";

export {
  FY2300_WAVEFORMS,
  FY6900_MAIN_WAVEFORMS,
  FY6900_AUX_WAVEFORMS,
  listWaveforms,
  waveformName,
  resolveWaveform,
} from "./waveforms.js";

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
 * USB vendor/product ID filters for FeelTech devices that ship with a CH340 / CH341 USB UART.
 * Use with `connectWeb({ filters: FEELTECH_USB_FILTERS })`.
 */
export const FEELTECH_USB_FILTERS = [
  { usbVendorId: 0x1a86, usbProductId: 0x7523 }, // CH340
  { usbVendorId: 0x10c4, usbProductId: 0xea60 }, // CP210x
  { usbVendorId: 0x067b, usbProductId: 0x2303 }, // PL2303
];
