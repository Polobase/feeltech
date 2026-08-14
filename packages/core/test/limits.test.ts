import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveCap, unknownLimits, type FrequencyLimits } from "../src/limits.js";

const partial: FrequencyLimits = {
  sine: { minHz: null, maxHz: 40e6 },
  square: { minHz: null, maxHz: null },
  arbitrary: { minHz: null, maxHz: null },
  verified: "partial",
  note: "Sine confirmed; square and arbitrary bandwidth undocumented.",
};

describe("resolveCap", () => {
  it("uses a published figure and labels it as spec", () => {
    assert.deepEqual(resolveCap(partial, "sine"), { hz: 40e6, source: "spec" });
  });

  it("falls back to the sine figure only as a labelled assumption", () => {
    // Square bandwidth can never exceed sine bandwidth, so this is an honest
    // ceiling — but it must never be reported as if it were a specification.
    assert.deepEqual(resolveCap(partial, "square"), {
      hz: 40e6,
      source: "assumed-sine",
    });
  });

  it("returns null rather than inventing a number when nothing is known", () => {
    assert.deepEqual(resolveCap(unknownLimits(), "square"), {
      hz: null,
      source: "unknown",
    });
  });

  it("does not fall back for sine itself", () => {
    assert.deepEqual(resolveCap(unknownLimits(), "sine"), {
      hz: null,
      source: "unknown",
    });
  });

  it("lets a user override win over the spec", () => {
    assert.deepEqual(resolveCap(partial, "sine", { sine: 100e6 }), {
      hz: 100e6,
      source: "user",
    });
  });

  it("ignores a non-finite override instead of propagating it", () => {
    assert.deepEqual(resolveCap(partial, "sine", { sine: Number.NaN }), {
      hz: 40e6,
      source: "spec",
    });
  });
});

describe("unknownLimits", () => {
  it("defaults to unverified with every range unknown", () => {
    const l = unknownLimits();
    assert.equal(l.verified, false);
    for (const kind of ["sine", "square", "arbitrary"] as const) {
      assert.equal(l[kind].minHz, null);
      assert.equal(l[kind].maxHz, null);
    }
  });

  it("omits optional keys rather than setting them undefined", () => {
    assert.equal("note" in unknownLimits(), false);
    assert.equal("sources" in unknownLimits(), false);
    assert.equal(unknownLimits(false, "why", ["ref"]).sources?.[0], "ref");
  });
});
