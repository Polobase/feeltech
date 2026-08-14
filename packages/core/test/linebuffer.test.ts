import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LineBuffer, encodeText } from "../src/transport.js";

describe("LineBuffer", () => {
  it("resolves a pending reader when a full line arrives", async () => {
    const buf = new LineBuffer();
    const [promise] = buf.readLine();
    buf.push("hello\n");
    assert.equal(await promise, "hello");
  });

  it("assembles lines from chunks split across boundaries", async () => {
    const buf = new LineBuffer();
    const [promise] = buf.readLine();
    buf.push("he");
    buf.push("llo\nwor");
    assert.equal(await promise, "hello");
    const [second] = buf.readLine();
    buf.push("ld\n");
    assert.equal(await second, "world");
  });

  it("strips a trailing CR", async () => {
    const buf = new LineBuffer();
    const [promise] = buf.readLine();
    buf.push("value\r\n");
    assert.equal(await promise, "value");
  });

  it("decodes UTF-8 byte chunks, including split multibyte sequences", async () => {
    const buf = new LineBuffer();
    const bytes = encodeText("50.0°\n");
    const [promise] = buf.readLine();
    // Split inside the ° multibyte sequence.
    buf.push(bytes.slice(0, 5));
    buf.push(bytes.slice(5));
    assert.equal(await promise, "50.0°");
  });

  it("resolves multiple pending readers in order", async () => {
    const buf = new LineBuffer();
    const [first] = buf.readLine();
    const [second] = buf.readLine();
    buf.push("one\ntwo\n");
    assert.equal(await first, "one");
    assert.equal(await second, "two");
  });

  it("cancel removes a pending reader", async () => {
    const buf = new LineBuffer();
    const [first, cancelFirst] = buf.readLine();
    cancelFirst();
    const [second] = buf.readLine();
    buf.push("line\n");
    assert.equal(await second, "line");
    // The cancelled promise must not have consumed the line.
    let firstResolved = false;
    void first.then(() => {
      firstResolved = true;
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(firstResolved, false);
  });

  it("reset discards buffered content", async () => {
    const buf = new LineBuffer();
    buf.push("stale");
    buf.reset();
    const [promise] = buf.readLine();
    buf.push("fresh\n");
    assert.equal(await promise, "fresh");
  });
});
