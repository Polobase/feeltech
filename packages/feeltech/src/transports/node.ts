/**
 * Node serial transport.
 *
 * The implementation now lives in `@freqgen/core/node`, shared with the
 * other generator drivers. This module stays as the `feeltech/node` entry point
 * so existing imports keep resolving.
 */

export {
  NodeSerialTransport,
  listPorts,
  findDevices,
  describeBridge,
  USB_SERIAL_BRIDGES,
  USB_SERIAL_VENDOR_IDS,
} from "@freqgen/core/node";
export type { PortInfo, UsbBridge, FindDevicesOptions } from "@freqgen/core/node";

import { USB_SERIAL_VENDOR_IDS } from "@freqgen/core/node";

/**
 * USB vendor IDs of the UART bridge chips FeelTech generators ship with
 * (CH340/CH341, CP210x, PL2303).
 *
 * @deprecated Prefer `USB_SERIAL_VENDOR_IDS` — same values, vendor-neutral name.
 */
export const FEELTECH_USB_VENDOR_IDS = USB_SERIAL_VENDOR_IDS;
