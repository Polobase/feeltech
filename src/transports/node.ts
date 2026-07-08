/**
 * Node.js transport using the `serialport` package.
 *
 * `serialport` is a peer dependency. It is loaded dynamically so that bundlers
 * targeting browsers can tree-shake this module away.
 */

import { FeelTechError, FeelTechTimeoutError } from "../types.js";
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
    throw new FeelTechError(
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
        stopBits: options.stopBits ?? 2,
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
          console.error("[feeltech] serial error:", err);
        }
      });
      port.on("close", () => {
        this.closed = true;
      });
      port.open((err) => {
        if (err) reject(new FeelTechError(`Failed to open ${this.path}`, err));
        else {
          this.port = port;
          resolve();
        }
      });
    });
  }

  async write(data: Uint8Array | string): Promise<void> {
    if (!this.port?.isOpen) throw new FeelTechError("Port not open");
    const bytes = typeof data === "string" ? encodeText(data) : data;
    return new Promise<void>((resolve, reject) => {
      this.port!.write(bytes, (err) => {
        if (err) reject(new FeelTechError("Serial write failed", err));
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
        reject(new FeelTechTimeoutError(`Read timed out after ${timeoutMs} ms`));
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
        if (err) reject(new FeelTechError("Flush failed", err));
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
          reject(new FeelTechError("Close failed", err));
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

/**
 * USB vendor IDs of the UART bridge chips FeelTech generators ship with
 * (CH340/CH341, CP210x, PL2303). Mirrors `FEELTECH_USB_FILTERS` on the web side.
 */
export const FEELTECH_USB_VENDOR_IDS = ["1a86", "10c4", "067b"] as const;

/**
 * List serial ports that look like a FeelTech generator (by USB vendor ID).
 *
 * The device path can change between USB ports (e.g. `wchusbserial110` vs
 * `wchusbserial1220` on macOS), so prefer this over hardcoding a path.
 *
 * macOS specifics: `/dev/tty.*` paths are rewritten to their `/dev/cu.*`
 * counterparts (the callout device is the right one for host-initiated
 * connections), and adapters that appear twice — once via Apple's built-in
 * CH340 driver (`usbserial-…`) and once via the WCH vendor driver
 * (`wchusbserial…`) — are deduplicated by physical USB location.
 */
export async function findDevices(): Promise<PortInfo[]> {
  const ports = await listPorts();
  const candidates = ports
    .filter(
      (p) =>
        p.vendorId !== undefined &&
        (FEELTECH_USB_VENDOR_IDS as readonly string[]).includes(p.vendorId.toLowerCase()),
    )
    .map((p) =>
      process.platform === "darwin" && p.path.startsWith("/dev/tty.")
        ? { ...p, path: "/dev/cu." + p.path.slice("/dev/tty.".length) }
        : p,
    );
  const byLocation = new Map<string, PortInfo>();
  for (const p of candidates) {
    const key = p.locationId ?? p.serialNumber ?? p.path;
    const existing = byLocation.get(key);
    const preferOverExisting =
      existing !== undefined &&
      p.path.includes("wchusbserial") &&
      !existing.path.includes("wchusbserial");
    if (!existing || preferOverExisting) byLocation.set(key, p);
  }
  return [...byLocation.values()];
}

export type { PortInfo };
