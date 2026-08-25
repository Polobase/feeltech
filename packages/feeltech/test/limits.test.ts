import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bandwidthFromModel, limitsForModel, traitsForModel } from "../src/limits.js";
import { resolveCap } from "@freqgen/core";

describe("bandwidthFromModel", () => {
  it("reads the marker off a real reported model string", () => {
    // This is exactly what an FY6300-60M answers to UMO.
    assert.equal(bandwidthFromModel("FY6300-60M"), 60e6);
  });

  it("handles the other variants of the same model family", () => {
    assert.equal(bandwidthFromModel("FY6900-100M"), 100e6);
    assert.equal(bandwidthFromModel("FY6900-20M"), 20e6);
    assert.equal(bandwidthFromModel("FY2300-40M"), 40e6);
  });

  it("tolerates whitespace and lowercase", () => {
    assert.equal(bandwidthFromModel("  fy6300-60m  "), 60e6);
    assert.equal(bandwidthFromModel("FY6300-60 M"), 60e6);
  });

  it("returns null when there is no marker rather than guessing", () => {
    assert.equal(bandwidthFromModel("FY6300"), null);
    assert.equal(bandwidthFromModel(""), null);
    assert.equal(bandwidthFromModel("FY6300-XX"), null);
  });
});

describe("limitsForModel", () => {
  it("populates only the sine figure, from the device's own model string", () => {
    const l = limitsForModel("FY6300-60M");
    assert.equal(l.sine.maxHz, 60e6);
    // Square and arbitrary bandwidth roll off below sine and are undocumented,
    // so they must stay unknown rather than inherit the headline number.
    assert.equal(l.square.maxHz, null);
    assert.equal(l.arbitrary.maxHz, null);
    assert.equal(l.verified, "partial");
  });

  it("reports everything unknown when the model carries no marker", () => {
    const l = limitsForModel("FY6300");
    assert.equal(l.sine.maxHz, null);
    assert.equal(l.verified, false);
  });

  it("feeds resolveCap so square is offered as a labelled ceiling only", () => {
    const l = limitsForModel("FY6300-60M");
    assert.deepEqual(resolveCap(l, "sine"), { hz: 60e6, source: "spec" });
    assert.deepEqual(resolveCap(l, "square"), { hz: 60e6, source: "assumed-sine" });
  });
});

describe("traitsForModel", () => {
  it("flags the FY6900 duty gate", () => {
    // FY6900 waveform 1 (Square) is fixed at 50 %; duty only bites on 2 (Rectangle).
    assert.equal(traitsForModel("FY6900-100M", "FY6900").dutyGatedByWaveform, true);
  });

  it("does not widen the duty gate to the rest of the protocol family", () => {
    // The FY6300 shares the wire format but not this firmware behaviour.
    assert.equal(traitsForModel("FY6300-60M", "FY6900").dutyGatedByWaveform, false);
    assert.equal(traitsForModel("FY6800", "FY6900").dutyGatedByWaveform, false);
    assert.equal(traitsForModel("FY2300", "FY2300").dutyGatedByWaveform, false);
  });

  it("reports two drivable channels even on the three-channel FY8300", () => {
    assert.equal(traitsForModel("FY8300", "FY6900").channels, 2);
  });
});
