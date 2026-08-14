/**
 * Web Serial transport.
 *
 * The implementation now lives in `@freqgen/core/web`, shared with the
 * other generator drivers. This module stays as the `feeltech/web` entry point
 * so existing imports keep resolving.
 */

export { WebSerialTransport } from "@freqgen/core/web";
export type { WebSerialFilter } from "@freqgen/core/web";
export {
  USB_SERIAL_BRIDGES,
  USB_SERIAL_FILTERS,
  USB_SERIAL_VENDOR_IDS,
  describeBridge,
} from "@freqgen/core/web";
export type { UsbBridge } from "@freqgen/core/web";
