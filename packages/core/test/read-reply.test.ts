import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LineBuffer, readReply, type SerialOpenOptions, type Transport } from "../src/transport.js";
import { AwgTimeoutError } from "../src/errors.js";

/**
 * A transport whose replies can be made deliberately late, to reproduce the
 * failure a real Gen X Pro produced: a reply that missed its window and then
 * spliced itself onto the next command's answer.
 */
class LateTransport implements Transport {
  readonly writes: string[] = [];
  private buffer = new LineBuffer();
  isOpen = false;

  async open(_o: SerialOpenOptions): Promise<void> {
    this.isOpen = true;
  }
  async write(data: Uint8Array | string): Promise<void> {
    this.writes.push(typeof data === "string" ? data : new TextDecoder().decode(data));
  }
  async readLine(timeoutMs: number): Promise<string> {
    const [promise, cancel] = this.buffer.readLine();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        cancel();
        reject(new AwgTimeoutError("timed out"));
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
    this.isOpen = false;
  }

  /** Deliver bytes after `delayMs`, as a slow device would. */
  replyAfter(delayMs: number, text: string): void {
    setTimeout(() => this.buffer.push(text), delayMs);
  }
  /** Deliver bytes with no trailing newline — a truncated frame. */
  pushRaw(text: string): void {
    this.buffer.push(text);
  }
}

describe("readReply", () => {
  it("returns the reply when it arrives in time", async () => {
    const t = new LateTransport();
    t.replyAfter(5, ":ok\r\n");
    assert.equal(await readReply(t, 200), ":ok");
  });

  it("returns null rather than throwing when nothing arrives", async () => {
    const t = new LateTransport();
    assert.equal(await readReply(t, 20, { graceMs: 5 }), null);
  });

  it("discards a straggler so it cannot answer the next command", async () => {
    // The Gen X Pro failure: a `:w92` reply landed after its window, and the
    // following `:r01=` read it — spliced with its own answer — instead.
    const t = new LateTransport();
    t.replyAfter(30, ":err\r\n");

    assert.equal(await readReply(t, 10, { graceMs: 60 }), null);

    // Next command: only its own reply should be visible.
    t.replyAfter(5, ":r01=G2.\r\n");
    assert.equal(await readReply(t, 200), ":r01=G2.");
  });

  it("clears a partial frame left behind by a timeout", async () => {
    // A half-arrived line has no newline, so it sits in the buffer and merges
    // with whatever comes next.
    const t = new LateTransport();
    t.pushRaw(":err\r");

    assert.equal(await readReply(t, 10, { graceMs: 5 }), null);

    t.replyAfter(5, ":r01=G2.\r\n");
    const next = await readReply(t, 200);
    assert.equal(next, ":r01=G2.");
    assert.ok(!next!.includes(":err"), "stale bytes leaked into the next reply");
  });

  it("skips the grace wait when asked to", async () => {
    const t = new LateTransport();
    const started = Date.now();
    assert.equal(await readReply(t, 10, { graceMs: 0 }), null);
    assert.ok(Date.now() - started < 100, "graceMs: 0 should not add a delay");
  });
});
