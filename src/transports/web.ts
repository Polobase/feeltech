/**
 * Web Serial API transport.
 *
 * Requires a browser with `navigator.serial` (Chrome, Edge, Opera).
 * Pass an already-opened {@link SerialPort} or one returned by
 * `navigator.serial.requestPort()`.
 */

import { FeelTechError, FeelTechTimeoutError } from "../types.js";
import {
  LineBuffer,
  encodeText,
  type SerialOpenOptions,
  type Transport,
} from "../transport.js";

export interface WebSerialFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

export class WebSerialTransport implements Transport {
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private lineBuffer = new LineBuffer();
  private readLoopPromise?: Promise<void>;
  private opened = false;

  constructor(public readonly port: SerialPort) {}

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  /**
   * Prompt the user to pick a port and return a transport for it.
   */
  static async request(filters: WebSerialFilter[] = []): Promise<WebSerialTransport> {
    if (!WebSerialTransport.isSupported()) {
      throw new FeelTechError("Web Serial API is not supported in this browser");
    }
    const port = await navigator.serial.requestPort({ filters });
    return new WebSerialTransport(port);
  }

  /**
   * Return previously-granted ports without prompting (useful to auto-reconnect).
   */
  static async getPorts(): Promise<WebSerialTransport[]> {
    if (!WebSerialTransport.isSupported()) return [];
    const ports = await navigator.serial.getPorts();
    return ports.map((p) => new WebSerialTransport(p));
  }

  get isOpen(): boolean {
    return this.opened;
  }

  async open(options: SerialOpenOptions): Promise<void> {
    await this.port.open({
      baudRate: options.baudRate,
      dataBits: options.dataBits ?? 8,
      stopBits: options.stopBits ?? 1,
      parity: options.parity ?? "none",
      flowControl: options.flowControl ?? "none",
    });
    if (!this.port.readable || !this.port.writable) {
      throw new FeelTechError("Port has no readable/writable streams");
    }
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.opened = true;
    this.readLoopPromise = this.readLoop();
  }

  private async readLoop(): Promise<void> {
    if (!this.reader) return;
    try {
      while (this.opened) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.lineBuffer.push(value);
      }
    } catch {
      // Reader closed/cancelled; exit loop.
    }
  }

  async write(data: Uint8Array | string): Promise<void> {
    if (!this.writer) throw new FeelTechError("Port not open");
    const bytes = typeof data === "string" ? encodeText(data) : data;
    await this.writer.write(bytes);
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

      linePromise.then(
        (line) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(line);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  async flush(): Promise<void> {
    this.lineBuffer.reset();
  }

  async close(): Promise<void> {
    this.opened = false;
    try {
      this.writer?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
    } catch {
      /* ignore */
    }
    if (this.readLoopPromise) {
      try {
        await this.readLoopPromise;
      } catch {
        /* ignore */
      }
    }
    try {
      await this.port.close();
    } catch {
      /* ignore */
    }
  }
}
