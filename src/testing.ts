/**
 * Test double for the {@link Transport} interface — lets you exercise
 * `FeelTech` (and your own code built on it) without hardware.
 *
 * ```ts
 * import { FeelTech } from "feeltech";
 * import { MockTransport } from "feeltech/testing";
 *
 * const mock = new MockTransport({ family: "FY6900" });
 * const fy = new FeelTech(mock);
 * await fy.open();
 * await fy.setFrequency(0, 1000);
 * assert(mock.writes.includes("WMF00001000.000000\n"));
 * ```
 *
 * The mock reproduces the FY-series response framing observed on real
 * hardware (see docs/serial_protocol.md §4):
 * - write commands are acknowledged with a bare `\n` (FY6900 family) or
 *   nothing (FY2300),
 * - read commands answer `<value>\n\n` (one trailing empty line),
 * - `UMO` answers `<value>\n\n\n\n`,
 * - `DDS_WAVE<n>` answers `W` and then consumes binary sample data.
 *
 * Written values are remembered, so a `WMF…` write is visible to a
 * subsequent `RMF` read — round-trip code works out of the box.
 */

import { FeelTechTimeoutError } from "./types.js";
import type { SerialOpenOptions, Transport } from "./transport.js";

/**
 * Custom responder: return a string (one response line), an array of lines,
 * or `undefined` to fall back to the built-in behaviour.
 */
export type MockResponder = (command: string) => string | string[] | undefined;

export interface MockTransportOptions {
  /** Device family to emulate. Default: "FY6900". */
  family?: "FY2300" | "FY6900";
  /** Model string returned for `UMO`. Default depends on family. */
  model?: string;
  /** ID string returned for `UID`. Default: "12345678". */
  id?: string;
  /** Custom responder consulted before the built-in behaviour. */
  responder?: MockResponder;
}

export class MockTransport implements Transport {
  /** Every write, in order: command strings verbatim (with `\n`). */
  readonly writes: string[] = [];
  /** Binary payloads written after a `DDS_WAVE` command. */
  readonly binaryWrites: Uint8Array[] = [];
  /** Uploaded arbitrary waveforms: slot → concatenated payload bytes. */
  readonly uploads: Array<{ slot: number; data: Uint8Array }> = [];
  /** Backing store for read commands (`RMF` → last `WMF` value, …). */
  readonly state = new Map<string, string>();
  /** Options passed to `open()`. */
  openOptions?: SerialOpenOptions;

  private readonly family: "FY2300" | "FY6900";
  private readonly model: string;
  private readonly id: string;
  private readonly responder?: MockResponder;
  private queue: string[] = [];
  private expectBinary = false;
  private open_ = false;
  private decoder = new TextDecoder();

  constructor(options: MockTransportOptions = {}) {
    this.family = options.family ?? "FY6900";
    this.model = options.model ?? (this.family === "FY2300" ? "FY2300-20M" : "FY6300-60M");
    this.id = options.id ?? "12345678";
    if (options.responder) this.responder = options.responder;
  }

  get isOpen(): boolean {
    return this.open_;
  }

  async open(options: SerialOpenOptions): Promise<void> {
    this.openOptions = options;
    this.open_ = true;
  }

  async close(): Promise<void> {
    this.open_ = false;
  }

  async flush(): Promise<void> {
    this.queue = [];
  }

  async readLine(_timeoutMs: number): Promise<string> {
    const line = this.queue.shift();
    if (line === undefined) {
      throw new FeelTechTimeoutError("MockTransport: no pending response");
    }
    return line;
  }

  async write(data: Uint8Array | string): Promise<void> {
    if (typeof data !== "string") {
      if (this.expectBinary) {
        this.binaryWrites.push(data);
        const upload = this.uploads[this.uploads.length - 1];
        if (upload) {
          const merged = new Uint8Array(upload.data.length + data.length);
          merged.set(upload.data);
          merged.set(data, upload.data.length);
          upload.data = merged;
        }
        this.expectBinary = false;
        return;
      }
      data = this.decoder.decode(data);
    }
    this.writes.push(data);
    for (const segment of data.split("\n")) {
      if (segment.length > 0) this.handleCommand(segment);
    }
  }

  private respond(...lines: string[]): void {
    this.queue.push(...lines);
  }

  private handleCommand(cmd: string): void {
    const custom = this.responder?.(cmd);
    if (custom !== undefined) {
      this.respond(...(typeof custom === "string" ? [custom, ""] : custom));
      return;
    }

    if (cmd === "UMO") {
      this.respond(this.model, "", "", "");
      return;
    }
    if (cmd === "UID") {
      this.respond(this.id, "");
      return;
    }
    if (cmd.startsWith("DDS_WAVE")) {
      const slot = Number(cmd.slice("DDS_WAVE".length));
      this.uploads.push({ slot, data: new Uint8Array(0) });
      this.expectBinary = true;
      this.respond("W");
      return;
    }
    if (cmd.startsWith("R")) {
      const value = this.state.get(cmd) ?? "0";
      if (this.family === "FY2300") this.respond(value);
      else this.respond(value, "");
      return;
    }

    // Write command: remember the value so the matching read returns it
    // (WMF… → RMF, USN… → RSN, SST… → RST).
    if (cmd.length >= 3) {
      this.state.set("R" + cmd.slice(1, 3), cmd.slice(3));
    }
    // FY6900 family acks writes with a bare newline; FY2300 stays silent.
    if (this.family !== "FY2300") this.respond("");
  }
}
