/**
 * Transport abstraction. Both Node (serialport) and Web (Web Serial API)
 * implementations conform to this interface.
 *
 * Conventions:
 * - `open()` configures the underlying port and starts the read loop.
 * - `write(data)` sends raw bytes (already terminated by `\n`).
 * - `readLine(timeoutMs)` resolves with the next line from the device,
 *   stripped of CR/LF. Times out with an `AwgTimeoutError` if no data
 *   arrives in time.
 * - `flush()` discards any pending bytes from the input buffer.
 * - `close()` releases the port.
 */

export interface SerialOpenOptions {
  baudRate: number;
  /** Defaults to 8. */
  dataBits?: 7 | 8;
  /**
   * Defaults to 1. Drivers set this explicitly (the FY6900 family needs 2, most
   * other generators need 1), so the default only matters for hand-rolled use.
   */
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
   * Returns a tuple of [promise, cancelFn] so the caller can clean up on timeout.
   */
  readLine(): [Promise<string>, () => void] {
    let resolver: ((line: string) => void) | undefined;
    const promise = new Promise<string>((resolve) => {
      resolver = resolve;
      this.resolvers.push(resolve);
      this.flush();
    });
    const cancel = () => {
      if (resolver) {
        const idx = this.resolvers.indexOf(resolver);
        if (idx >= 0) this.resolvers.splice(idx, 1);
      }
    };
    return [promise, cancel];
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

/**
 * Read one reply, leaving the input buffer clean if it never arrives.
 *
 * A plain `readLine()` that times out is not enough for request/response
 * protocols. The reply may simply be late — and once it lands, the *next*
 * command reads it instead of its own answer, or worse, reads the two spliced
 * into one line. Observed on a Spooky2 Gen X Pro: a `:w92` reply that missed
 * its window turned the following `:r01=` into `":err\r␀:r01=G2."`.
 *
 * So on timeout this waits a grace period for the straggler and discards
 * whatever turned up, putting the link back in a known state.
 *
 * @returns the reply, or `null` if none arrived in time.
 */
export async function readReply(
  transport: Transport,
  timeoutMs: number,
  options: { graceMs?: number } = {},
): Promise<string | null> {
  try {
    return await transport.readLine(timeoutMs);
  } catch {
    // Give a straggling reply time to land, then drop it — anything arriving
    // now belongs to the command we just gave up on.
    const grace = options.graceMs ?? 50;
    if (grace > 0) await new Promise((resolve) => setTimeout(resolve, grace));
    await transport.flush();
    return null;
  }
}
