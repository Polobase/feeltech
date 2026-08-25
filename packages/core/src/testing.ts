/**
 * Transport test doubles — exercise a driver without hardware.
 *
 * {@link RecordingTransport} is the vendor-neutral one: it records every byte
 * written and replays scripted responses. That is enough to write *wire
 * transcript* tests, which assert the exact bytes a driver emits for a given
 * API call. For devices nobody here can plug in, conformance to the documented
 * protocol is the strongest claim available, and this is how it gets checked.
 *
 * ```ts
 * const t = new RecordingTransport({ defaultResponse: "ok" });
 * const gen = new SomeDriver(t);
 * await gen.open();
 * await gen.setFrequency(0, 440);
 * assert.deepEqual(t.writes, [":w23440\r\n"]);
 * ```
 */

import { AwgTimeoutError } from "./errors.js";
import { LineBuffer, type SerialOpenOptions, type Transport } from "./transport.js";

/**
 * Answer a command. Return a line, several lines, or `undefined` to fall
 * through to `defaultResponse`.
 */
export type MockResponder = (command: string) => string | string[] | undefined;

export interface RecordingTransportOptions {
  /**
   * Reply sent for any write with no scripted answer. `undefined` (the default)
   * means the device stays silent, which is what write-only protocols do.
   */
  defaultResponse?: string | string[];
  /** Custom per-command responder, consulted before `defaultResponse`. */
  responder?: MockResponder;
}

export class RecordingTransport implements Transport {
  /** Every chunk passed to `write()`, decoded as UTF-8, in order. */
  readonly writes: string[] = [];
  /** Options `open()` was called with — lets tests assert baud rate and framing. */
  openOptions?: SerialOpenOptions;

  private buffer = new LineBuffer();
  private opened = false;
  private decoder = new TextDecoder();

  constructor(private options: RecordingTransportOptions = {}) {}

  get isOpen(): boolean {
    return this.opened;
  }

  async open(options: SerialOpenOptions): Promise<void> {
    this.openOptions = options;
    this.opened = true;
  }

  async write(data: Uint8Array | string): Promise<void> {
    const text = typeof data === "string" ? data : this.decoder.decode(data);
    this.writes.push(text);
    const reply = this.options.responder?.(text) ?? this.options.defaultResponse;
    if (reply === undefined) return;
    for (const line of Array.isArray(reply) ? reply : [reply]) {
      this.buffer.push(line + "\n");
    }
  }

  async readLine(timeoutMs: number): Promise<string> {
    const [promise, cancel] = this.buffer.readLine();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        cancel();
        reject(new AwgTimeoutError(`Read timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async flush(): Promise<void> {
    this.buffer.reset();
  }

  async close(): Promise<void> {
    this.opened = false;
    this.buffer.reset();
  }

  /** Queue a line as if the device had sent it unprompted. */
  push(line: string): void {
    this.buffer.push(line + "\n");
  }

  /** Forget recorded writes — handy between phases of a longer test. */
  clear(): void {
    this.writes.length = 0;
  }
}
