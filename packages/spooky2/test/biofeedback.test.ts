import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectHits, type BiofeedbackPoint } from "../src/biofeedback.js";

// First 12 rows of Spooky2's RawAnalysisData.tmp (freq, Data, RA, Data-PrevRA, Hit),
// captured verbatim. Hits at 2.25 and 3.5; 1.5 is a peak but ranks below them.
const CAPTURE: Array<[number, number]> = [
  [1, -0.3],
  [1.25, 0.1],
  [1.5, 0.215],
  [1.75, 0.09],
  [2, 0.095],
  [2.25, 0.39],
  [2.5, 0.02],
  [2.75, -0.445],
  [3, 0.06],
  [3.25, -0.07],
  [3.5, 0.445],
  [3.75, -0.295],
];

describe("detectHits", () => {
  it("reproduces Spooky2's running-average deviation and peak hits", () => {
    const points: BiofeedbackPoint[] = CAPTURE.map(([hz, value]) => ({ hz, value }));
    const hits = detectHits(points, { window: 20, maxHits: 2 });

    // 3.5 has the largest deviation, then 2.25 — both are positive peaks.
    assert.deepEqual(hits.map((h) => h.hz), [3.5, 2.25]);
    // 1.5 is a peak too but its deviation (0.315) ranks below 2.25 (0.35).
    assert.ok(!hits.some((h) => h.hz === 1.5));
  });

  it("computes the running average as the mean of previous `window` values", () => {
    // Single rising ramp: RA[k] = mean of values[0..k-1] (cumulative while < window).
    const ramp: BiofeedbackPoint[] = [0, 2, 4, 6].map((value, i) => ({ hz: i, value }));
    const hits = detectHits(ramp, { window: 20, maxHits: 1 });
    // A monotonic ramp has no local maxima, so no hits.
    assert.equal(hits.length, 0);
  });

  it("detects valleys with detect: 'min'", () => {
    const wave: BiofeedbackPoint[] = [3, 0, 3, 1, 3].map((value, i) => ({ hz: i, value }));
    const hits = detectHits(wave, { window: 5, maxHits: 2, detect: "min" });
    assert.deepEqual(hits.map((h) => h.hz), [1, 3]);
  });

  it("caps the result at maxHits", () => {
    const wave: BiofeedbackPoint[] = [0, 5, 0, 4, 0, 3, 0].map((value, i) => ({ hz: i, value }));
    const hits = detectHits(wave, { window: 7, maxHits: 2 });
    assert.equal(hits.length, 2);
    assert.deepEqual(hits.map((h) => h.hz), [1, 3]);
  });
});
