/**
 * Node.js transport using the `serialport` package.
 *
 * `serialport` is a peer dependency. It is loaded dynamically so that bundlers
 * targeting browsers can tree-shake this module away.
 */

import { AwgError, AwgTimeoutError } from "../errors.js";
import { USB_SERIAL_VENDOR_IDS } from "../usb.js";
import {
  LineBuffer,
  encodeText,
  type SerialOpenOptions,
  type Transport,
} from "../transport.js";

type SerialPortCtor = new (options: {
  path: string;
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 1.5 | 2;
  parity: "none" | "even" | "odd";
  rtscts?: boolean;
  xon?: boolean;
  xoff?: boolean;
  autoOpen?: boolean;
}) => SerialPortInstance;

interface SerialPortInstance {
  open(callback?: (err: Error | null) => void): void;
  close(callback?: (err: Error | null) => void): void;
  write(
    data: Uint8Array | string,
    callback?: (err: Error | null | undefined) => void,
  ): boolean;
  flush(callback?: (err: Error | null | undefined) => void): void;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "close", listener: () => void): this;
  removeAllListeners(): this;
  isOpen: boolean;
}

interface PortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
}

type SerialPortModule = {
  SerialPort: SerialPortCtor & { list(): Promise<PortInfo[]> };
};

let cachedSerialPort: SerialPortModule | undefined;

async function loadSerialPort(): Promise<SerialPortModule> {
  if (cachedSerialPort) return cachedSerialPort;
  try {
    // Use eval-style import so bundlers don't try to resolve at build time.
    const moduleName = "serialport";
    const mod = (await import(/* @vite-ignore */ moduleName)) as SerialPortModule;
    cachedSerialPort = mod;
    return mod;
  } catch (err) {
    throw new AwgError(
      "The 'serialport' package is not installed (its optional install may have " +
        "been skipped or failed to build). Run `npm install serialport`.",
      err,
    );
  }
}

export class NodeSerialTransport implements Transport {
  private port?: SerialPortInstance;
  private lineBuffer = new LineBuffer();
  private closed = false;

  constructor(public readonly path: string) {}

  get isOpen(): boolean {
    return !!this.port?.isOpen;
  }

  async open(options: SerialOpenOptions): Promise<void> {
    const { SerialPort } = await loadSerialPort();
    return new Promise<void>((resolve, reject) => {
      const port = new SerialPort({
        path: this.path,
        baudRate: options.baudRate,
        dataBits: options.dataBits ?? 8,
        stopBits: options.stopBits ?? 1,
        parity: options.parity ?? "none",
        rtscts: options.flowControl === "hardware",
        xon: false,
        xoff: false,
        autoOpen: false,
      });
      port.on("data", (chunk) => this.lineBuffer.push(new Uint8Array(chunk)));
      port.on("error", (err) => {
        // Surface to any pending readLine
        this.lineBuffer.push("");
        if (!this.closed) {
          // Best-effort: log via console; library users should also handle device errors via try/catch on read/write.
          console.error("[awg-core] serial error:", err);
        }
      });
      port.on("close", () => {
        this.closed = true;
      });
      port.open((err) => {
        if (err) reject(new AwgError(`Failed to open ${this.path}`, err));
        else {
          this.port = port;
          resolve();
        }
      });
    });
  }

  async write(data: Uint8Array | string): Promise<void> {
    if (!this.port?.isOpen) throw new AwgError("Port not open");
    const bytes = typeof data === "string" ? encodeText(data) : data;
    return new Promise<void>((resolve, reject) => {
      this.port!.write(bytes, (err) => {
        if (err) reject(new AwgError("Serial write failed", err));
        else resolve();
      });
    });
  }

  async readLine(timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const [linePromise, cancel] = this.lineBuffer.readLine();

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cancel();
        reject(new AwgTimeoutError(`Read timed out after ${timeoutMs} ms`));
      }, timeoutMs);

      linePromise
        .then((line) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(line);
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  async flush(): Promise<void> {
    this.lineBuffer.reset();
    if (!this.port?.isOpen) return;
    return new Promise<void>((resolve, reject) => {
      this.port!.flush((err) => {
        if (err) reject(new AwgError("Flush failed", err));
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (!this.port?.isOpen) return;
    return new Promise<void>((resolve, reject) => {
      this.port!.removeAllListeners();
      this.port!.close((err) => {
        if (err && err.message !== "Port is not open")
          reject(new AwgError("Close failed", err));
        else resolve();
      });
    });
  }
}

/**
 * List available serial ports. Useful for picking a port when the path is unknown.
 */
export async function listPorts(): Promise<PortInfo[]> {
  const { SerialPort } = await loadSerialPort();
  return SerialPort.list();
}

export interface FindDevicesOptions {
  /**
   * Restrict to these USB vendor IDs (lowercase hex). Defaults to every vendor
   * in {@link USB_SERIAL_VENDOR_IDS}.
   */
  vendorIds?: readonly string[];
}

/**
 * The interface a macOS device path refers to, with the driver's naming
 * convention stripped off.
 *
 * macOS shows one physical interface twice when two drivers claim it — Apple's
 * built-in CDC driver and the vendor's — as `usbmodem5B230040901` and
 * `wchusbserial5B230040901`. What is left after removing the prefix identifies
 * the interface itself, so the two views collapse while genuinely separate
 * interfaces (…901 vs …903) stay apart.
 */
function interfaceId(path: string): string {
  const base = path.replace(/^.*\//, "").replace(/^(cu|tty)\./, "");
  return base.replace(/^(wchusbserial|usbserial-|usbserial|usbmodem|SLAB_USBtoUART)/, "");
}

/**
 * List serial ports that look like a generator (by USB vendor ID).
 *
 * The device path can change between USB ports (e.g. `wchusbserial110` vs
 * `wchusbserial1220`), so prefer this over hardcoding a path.
 *
 * On macOS, `/dev/tty.*` paths are rewritten to their `/dev/cu.*` counterparts
 * (the callout device is the right one for host-initiated connections), and an
 * adapter claimed by both Apple's driver and the vendor's is deduplicated,
 * keeping the vendor node.
 *
 * That deduplication keys on the *interface*, not the USB location. A
 * multi-port bridge puts several independent devices at one location — a
 * Spooky2 Gen X Pro presents both of its generators through a single CH34x —
 * and keying on location would hide all but the first.
 */
export async function findDevices(options: FindDevicesOptions = {}): Promise<PortInfo[]> {
  const vendorIds = options.vendorIds ?? USB_SERIAL_VENDOR_IDS;
  const ports = await listPorts();
  const candidates = ports
    .filter(
      (p) => p.vendorId !== undefined && vendorIds.includes(p.vendorId.toLowerCase()),
    )
    .map((p) =>
      process.platform === "darwin" && p.path.startsWith("/dev/tty.")
        ? { ...p, path: "/dev/cu." + p.path.slice("/dev/tty.".length) }
        : p,
    );

  // Only macOS shows one interface under two names; elsewhere each node is
  // already a distinct interface and deduplicating could only lose devices.
  if (process.platform !== "darwin") return candidates;

  const byInterface = new Map<string, PortInfo>();
  for (const p of candidates) {
    const key = `${p.locationId ?? p.serialNumber ?? ""}:${interfaceId(p.path)}`;
    const existing = byInterface.get(key);
    const preferOverExisting =
      existing !== undefined &&
      p.path.includes("wchusbserial") &&
      !existing.path.includes("wchusbserial");
    if (!existing || preferOverExisting) byInterface.set(key, p);
  }
  return [...byInterface.values()];
}

export {
  USB_SERIAL_BRIDGES,
  USB_SERIAL_VENDOR_IDS,
  describeBridge,
} from "../usb.js";
export type { UsbBridge } from "../usb.js";

export type { PortInfo };
