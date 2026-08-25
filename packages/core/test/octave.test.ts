import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { foldToBand, fitFrequencies } from "../src/octave.js";

describe("foldToBand", () => {
  it("leaves an in-band frequency alone", () => {
    assert.deepEqual(foldToBand(1500, { loHz: 1000, hiHz: 2000 }), {
      hz: 1500,
      octaves: 0,
    });
  });

  it("reproduces the worked 320 MHz example", () => {
    // Field convention: a 320 MHz fundamental is catalogued as 20 MHz (halved
    // 16 times); eight further halvings land it on exactly 2.5 MHz.
    const catalogued = foldToBand(320e6, { hiHz: 20e6 });
    assert.equal(catalogued?.hz, 20e6);
    assert.equal(catalogued?.octaves, -4); // 320 → 160 → 80 → 40 → 20

    const folded = foldToBand(20e6, { hiHz: 2.5e6 });
    assert.equal(folded?.hz, 2.5e6);
    assert.equal(folded?.octaves, -3); // 20 → 10 → 5 → 2.5
  });

  it("doubles up into the band", () => {
    assert.deepEqual(foldToBand(125, { loHz: 1000, hiHz: 2000 }), {
      hz: 1000,
      octaves: 3,
    });
  });

  it("halves down into the band", () => {
    assert.deepEqual(foldToBand(16000, { loHz: 1000, hiHz: 2000 }), {
      hz: 2000,
      octaves: -3,
    });
  });

  it("returns null when the band is narrower than an octave and is skipped over", () => {
    // 100..150 Hz is narrower than one octave: 60 doubles to 120 (fits), but
    // 80 doubles to 160 — past the ceiling with nowhere to land.
    assert.equal(foldToBand(80, { loHz: 100, hiHz: 150 })?.hz, undefined);
    assert.equal(foldToBand(60, { loHz: 100, hiHz: 150 })?.hz, 120);
  });

  it("treats an unbounded side as no constraint", () => {
    assert.deepEqual(foldToBand(7, {}), { hz: 7, octaves: 0 });
    assert.deepEqual(foldToBand(7, { loHz: 100 }), { hz: 112, octaves: 4 });
  });

  it("rejects non-positive and non-finite input", () => {
    assert.equal(foldToBand(0, { loHz: 1, hiHz: 2 }), null);
    assert.equal(foldToBand(-5, { loHz: 1, hiHz: 2 }), null);
    assert.equal(foldToBand(Number.NaN, { loHz: 1, hiHz: 2 }), null);
    assert.equal(foldToBand(Number.POSITIVE_INFINITY, { loHz: 1, hiHz: 2 }), null);
  });

  it("gives up rather than looping forever on a degenerate ceiling", () => {
    // Guard at 64 octaves: 1e30 Hz cannot reach a 1 Hz ceiling in that many halvings.
    assert.equal(foldToBand(1e30, { hiHz: 1 }), null);
  });
});

describe("fitFrequencies", () => {
  const band = { loHz: 1e6, hiHz: 2e6 };

  it("reports native when nothing needs moving", () => {
    const fit = fitFrequencies([1.2e6, 1.8e6], band);
    assert.equal(fit.status, "native");
    assert.equal(fit.shifted, 0);
    assert.equal(fit.maxShift, 0);
    assert.deepEqual(fit.warnings, []);
  });

  it("reports shift and the largest shift applied", () => {
    const fit = fitFrequencies([1.5e6, 727.5], band);
    assert.equal(fit.status, "shift");
    assert.equal(fit.shifted, 1);
    assert.equal(fit.maxShift, 11); // 727.5 × 2^11 = 1_490_000 Hz
    assert.equal(fit.blocked, 0);
  });

  it("reports blocked when a frequency cannot be placed", () => {
    const fit = fitFrequencies([80], { loHz: 100, hiHz: 150 });
    assert.equal(fit.status, "blocked");
    assert.equal(fit.blocked, 1);
  });

  it("clamps the band by the generator cap and warns", () => {
    const fit = fitFrequencies([1.5e6], band, { capHz: 1.2e6, capSource: "spec" });
    assert.equal(fit.overCap, 1);
    assert.ok(fit.warnings.includes("gen-cap"));
    // 1.5 MHz exceeds the 1.2 MHz cap and halving drops below the 1 MHz floor.
    assert.equal(fit.status, "blocked");
  });

  it("flags an assumed cap without pretending it is a spec", () => {
    const fit = fitFrequencies([1.5e6], band, { capHz: 40e6, capSource: "assumed-sine" });
    assert.ok(fit.warnings.includes("cap-assumed"));
    assert.equal(fit.status, "native");
  });

  it("flags a wholly unknown cap", () => {
    const fit = fitFrequencies([1.5e6], band, { capHz: null, capSource: "unknown" });
    assert.ok(fit.warnings.includes("cap-unknown"));
  });

  it("reports partial when everything lands outside the optimal sub-range", () => {
    const fit = fitFrequencies([1.9e6], band, { optimal: { loHz: 1e6, hiHz: 1.2e6 } });
    assert.equal(fit.status, "partial");
    assert.equal(fit.outOfOptimal, 1);
    assert.ok(fit.warnings.includes("out-of-optimal"));
  });

  it("ignores non-positive entries rather than counting them as blocked", () => {
    const fit = fitFrequencies([1.5e6, 0, -3, Number.NaN], band);
    assert.equal(fit.total, 1);
    assert.equal(fit.blocked, 0);
    assert.equal(fit.status, "native");
  });
});
