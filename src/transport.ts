/**
 * Transport abstraction. Both Node (serialport) and Web (Web Serial API)
 * implementations conform to this interface.
 *
 * Conventions:
 * - `open()` configures the underlying port and starts the read loop.
 * - `write(data)` sends raw bytes (already terminated by `\n`).
 * - `readLine(timeoutMs)` resolves with the next line from the device,
 *   stripped of CR/LF. Times out with a `FeelTechTimeoutError` if no data
 *   arrives in time.
 * - `flush()` discards any pending bytes from the input buffer.
 * - `close()` releases the port.
 */

export interface SerialOpenOptions {
  baudRate: number;
  /** Defaults to 8. */
  dataBits?: 7 | 8;
  /** Defaults to 1. FY6900 family REQUIRES 2. */
  stopBits?: 1 | 2;
  /** Defaults to "none". */
  parity?: "none" | "even" | "odd";
  /** Defaults to "none". */
  flowControl?: "none" | "hardware";
}

export interface Transport {
  open(options: SerialOpenOptions): Promise<void>;
  write(data: Uint8Array | string): Promise<void>;
  readLine(timeoutMs: number): Promise<string>;
  flush(): Promise<void>;
  close(): Promise<void>;
  readonly isOpen: boolean;
}

/**
 * Buffered line reader that converts a stream of byte chunks into newline-delimited
 * UTF-8 strings. Used by both transport implementations to provide `readLine`.
 */
export class LineBuffer {
  private buf = "";
  private resolvers: Array<(line: string) => void> = [];
  private decoder = new TextDecoder("utf-8");

  /** Push a chunk of bytes (or string) into the buffer. */
  push(chunk: Uint8Array | string): void {
    const str =
      typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    this.buf += str;
    this.flush();
  }

  /** Flush completed lines to any pending readLine() callers. */
  private flush(): void {
    while (this.resolvers.length > 0) {
      const idx = this.findLineEnd();
      if (idx < 0) return;
      const line = this.buf.slice(0, idx).replace(/\r$/, "");
      this.buf = this.buf.slice(idx + 1);
      const resolver = this.resolvers.shift()!;
      resolver(line);
    }
  }

  private findLineEnd(): number {
    return this.buf.indexOf("\n");
  }

  /**
   * Wait for the next line. If a line is already buffered, resolves synchronously
   * on the next microtask.
   */
  readLine(): Promise<string> {
    return new Promise<string>((resolve) => {
      this.resolvers.push(resolve);
      this.flush();
    });
  }

  /** Discard buffered data and any pending readers. */
  reset(): void {
    this.buf = "";
    this.resolvers = [];
  }
}

/** Convert a string to Uint8Array (UTF-8). */
export function encodeText(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
