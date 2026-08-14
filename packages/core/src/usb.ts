/**
 * USB-serial bridge chips these generators ship with.
 *
 * Shared by both transports: the Node side filters `SerialPort.list()` by
 * vendor ID, the web side turns the same table into `navigator.serial`
 * request filters. No `serialport` import here, so browsers can use it.
 */

export interface UsbBridge {
  /** Lowercase 4-hex-digit USB vendor ID. */
  vendorId: string;
  /** Lowercase 4-hex-digit USB product ID. */
  productId: string;
  label: string;
  /**
   * True when one physical unit enumerates as two serial devices. The Gen X Pro
   * does this: each of its two generators is its own port, so a pair is
   * expected rather than a duplicate to collapse.
   */
  dualPort?: boolean;
}

/** USB-serial bridges known to appear on supported generators. */
export const USB_SERIAL_BRIDGES: readonly UsbBridge[] = [
  { vendorId: "1a86", productId: "7523", label: "CH340" },
  { vendorId: "1a86", productId: "5523", label: "CH341" },
  { vendorId: "10c4", productId: "ea60", label: "CP2102" },
  { vendorId: "10c4", productId: "ea70", label: "CP2105", dualPort: true },
  { vendorId: "10c4", productId: "ea71", label: "CP2108", dualPort: true },
  { vendorId: "067b", productId: "2303", label: "PL2303" },
];

/**
 * Vendor IDs of every bridge above (CH34x, CP210x, PL2303). Product IDs vary
 * per board revision, so vendor ID is the practical filter.
 */
export const USB_SERIAL_VENDOR_IDS: readonly string[] = [
  ...new Set(USB_SERIAL_BRIDGES.map((b) => b.vendorId)),
];

/** Web Serial `requestPort({ filters })` form of {@link USB_SERIAL_BRIDGES}. */
export const USB_SERIAL_FILTERS: ReadonlyArray<{
  usbVendorId: number;
  usbProductId: number;
}> = USB_SERIAL_BRIDGES.map((b) => ({
  usbVendorId: Number.parseInt(b.vendorId, 16),
  usbProductId: Number.parseInt(b.productId, 16),
}));

/** Identify the bridge chip behind a port, when its IDs are known. */
export function describeBridge(ids: {
  vendorId?: string | undefined;
  productId?: string | undefined;
}): UsbBridge | undefined {
  const vid = ids.vendorId?.toLowerCase();
  const pid = ids.productId?.toLowerCase();
  if (!vid) return undefined;
  return (
    USB_SERIAL_BRIDGES.find((b) => b.vendorId === vid && b.productId === pid) ??
    USB_SERIAL_BRIDGES.find((b) => b.vendorId === vid)
  );
}
