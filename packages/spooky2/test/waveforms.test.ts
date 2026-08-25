import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SPOOKY2_WAVEFORMS,
  SPOOKY2_WAVEFORM_NAMES,
  SPOOKY2_WAVEFORM_SAMPLES,
  spooky2Waveform,
} from "../src/waveforms.js";

describe("Spooky2 waveform tables", () => {
  it("ships the eleven named Spooky2 waveforms at 1024 samples", () => {
    assert.equal(SPOOKY2_WAVEFORM_SAMPLES, 1024);
    assert.deepEqual(SPOOKY2_WAVEFORM_NAMES, [
      "sine",
      "square",
      "sawtooth",
      "invertedSawtooth",
      "triangle",
      "sineDamped",
      "squareDamped",
      "sineHbomb",
      "squareHbomb",
      "userDefined1",
      "userDefined2",
    ]);
  });

  it("keeps every sample within the normalised range", () => {
    for (const name of SPOOKY2_WAVEFORM_NAMES) {
      const wave = SPOOKY2_WAVEFORMS[name];
      assert.equal(wave.length, 1024, `${name} wrong length`);
      for (const v of wave) {
        assert.ok(v >= -1.0001 && v <= 1.0001, `${name} out of range: ${v}`);
      }
    }
  });

  it("has the shapes its names claim", () => {
    // Square is two levels only.
    assert.deepEqual([...new Set(SPOOKY2_WAVEFORMS.square)].sort(), [-1, 1]);
    // Sawtooth rises monotonically through the bulk before its wrap.
    const saw = SPOOKY2_WAVEFORMS.sawtooth;
    assert.ok(saw[256]! < saw[512]! && saw[512]! < saw[768]!, "sawtooth not rising");
    // Sine crosses zero near the midpoint.
    assert.ok(Math.abs(SPOOKY2_WAVEFORMS.sine[512]!) < 0.05, "sine not zero at midpoint");
    // The damped waveforms decay: their late-cycle peak is smaller than early.
    const early = Math.max(...SPOOKY2_WAVEFORMS.sineDamped.slice(0, 200).map(Math.abs));
    const late = Math.max(...SPOOKY2_WAVEFORMS.sineDamped.slice(800).map(Math.abs));
    assert.ok(late < early, "sineDamped does not decay");
  });

  it("looks up by name and reports unknowns", () => {
    assert.equal(spooky2Waveform("triangle")?.length, 1024);
    assert.equal(spooky2Waveform("nope"), undefined);
  });
});
