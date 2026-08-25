import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeWaveform, resampleWaveform } from "../src/waveform-utils.js";

describe("resampleWaveform", () => {
  it("returns a copy when the length already matches", () => {
    const input = [1, 2, 3];
    const out = resampleWaveform(input, 3);
    assert.deepEqual(out, input);
    assert.notEqual(out, input);
  });

  it("upsamples with linear interpolation, preserving endpoints", () => {
    const out = resampleWaveform([0, 1], 5);
    assert.deepEqual(out, [0, 0.25, 0.5, 0.75, 1]);
  });

  it("downsamples, preserving endpoints", () => {
    const out = resampleWaveform([0, 1, 2, 3, 4], 3);
    assert.deepEqual(out, [0, 2, 4]);
  });

  it("defaults to 8192 points", () => {
    const out = resampleWaveform([0, 1]);
    assert.equal(out.length, 8192);
    assert.equal(out[0], 0);
    assert.equal(out[8191], 1);
  });

  it("handles single-sample input and single-point output", () => {
    assert.deepEqual(resampleWaveform([7], 3), [7, 7, 7]);
    assert.deepEqual(resampleWaveform([1, 2, 3], 1), [1]);
  });

  it("rejects empty input and bad lengths", () => {
    assert.throws(() => resampleWaveform([], 8));
    assert.throws(() => resampleWaveform([1], 0));
    assert.throws(() => resampleWaveform([1], 2.5));
  });
});

describe("normalizeWaveform", () => {
  it("scales symmetrically into −1…+1", () => {
    assert.deepEqual(normalizeWaveform([0, 5, 10]), [-1, 0, 1]);
    assert.deepEqual(normalizeWaveform([-2, 0, 2]), [-1, 0, 1]);
  });

  it("maps constant input to zeros", () => {
    assert.deepEqual(normalizeWaveform([3, 3, 3]), [0, 0, 0]);
  });

  it("rejects empty and non-finite input", () => {
    assert.throws(() => normalizeWaveform([]));
    assert.throws(() => normalizeWaveform([1, NaN]));
    assert.throws(() => normalizeWaveform([1, Infinity]));
  });
});
