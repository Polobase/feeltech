import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  frequencySpacing,
  spectrumPercent,
  spectrumFrequencies,
  spectrum,
} from "../src/spectrum.js";

describe("Spooky2 Spectrum math (User's Guide examples)", () => {
  it("Example 1: 1.5 MHz, 0.025 %, WCM 50", () => {
    // Guide: FS = 1,500,000 × 0.00025 = 375; Spectrum % = 50×100×375÷1.5e6 = 1.25
    assert.equal(frequencySpacing(1_500_000, 0.00025), 375);
    assert.equal(spectrumPercent(1_500_000, 0.00025, 50), 1.25);
  });

  it("Example 2: 500 Hz, 0.025 %, WCM 10", () => {
    // Guide: FS = 500 × 0.00025 = 0.125; Spectrum % = 10×100×0.125÷500 = 0.25
    assert.equal(frequencySpacing(500, 0.00025), 0.125);
    assert.equal(spectrumPercent(500, 0.00025, 10), 0.25);
  });

  it("makes 2×WCM+1 frequencies, centred, in order", () => {
    const freqs = spectrumFrequencies(1000, 0.001, 2); // spacing = 1 Hz
    assert.deepEqual(freqs, [998, 999, 1000, 1001, 1002]);
  });

  it("summarises the whole cluster", () => {
    const s = spectrum(1_500_000, 0.00025, 50);
    assert.equal(s.frequencySpacingHz, 375);
    assert.equal(s.spectrumPercent, 1.25);
    assert.equal(s.frequencyCount, 101); // 50 below + centre + 50 above
    assert.equal(s.lowHz, 1_500_000 - 50 * 375);
    assert.equal(s.highHz, 1_500_000 + 50 * 375);
  });
});
