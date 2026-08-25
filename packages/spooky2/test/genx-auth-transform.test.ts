import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { genXAuthResponse, GENX_AUTH_PROVIDER } from "../src/genx-auth-transform.js";

describe("genXAuthResponse", () => {
  it("matches the self-check vector from the disassembly", () => {
    // Confirmed end-to-end: this response unlocks a real Gen X Pro (firmware 200).
    assert.equal(genXAuthResponse("516793428", "621534987"), "319652537");
  });

  it("returns nine digits in 1–9", () => {
    const r = genXAuthResponse("123456789", "987654321");
    assert.match(r!, /^[1-9]{9}$/);
  });

  it("is deterministic", () => {
    assert.equal(
      genXAuthResponse("192837465", "564738291"),
      genXAuthResponse("192837465", "564738291"),
    );
  });

  it("returns null when a challenge value is too short", () => {
    assert.equal(genXAuthResponse("12345", "621534987"), null);
    assert.equal(genXAuthResponse("516793428", "62153"), null);
  });
});

describe("GENX_AUTH_PROVIDER", () => {
  it("responds to a challenge", async () => {
    const r = await GENX_AUTH_PROVIDER.respond({
      nonce: "516793428",
      v1: "000000000",
      v2: "621534987",
    });
    assert.equal(r, "319652537");
  });

  it("throws on a challenge too short to answer", () => {
    assert.throws(
      () => GENX_AUTH_PROVIDER.respond({ nonce: "1", v1: "", v2: "2" }),
      /challenge too short/,
    );
  });
});
