import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  amplitudeRegisterValue,
  channelSlot,
  outField,
  encodeGenXFrequency,
  decodeGenXFrequency,
} from "../src/genx-wire.js";

describe("channelSlot (two-field, shared registers)", () => {
  it("fills the first field for channel 0 and the second for channel 1", () => {
    assert.equal(channelSlot(0, 14), "14,,");
    assert.equal(channelSlot(1, 14), ",14,");
  });
});

describe("outField (single-field, per-output registers)", () => {
  it("puts the value in field 1 regardless of output", () => {
    assert.equal(outField(10008), "10008,");
    assert.equal(outField(500), "500,");
  });
});

describe("encodeGenXFrequency", () => {
  it("matches the values read off the device display", () => {
    // Confirmed on a real Gen X Pro (firmware 200):
    assert.equal(encodeGenXFrequency(1000), 10008); // display 1000.00000000 Hz
    assert.equal(encodeGenXFrequency(727.5), 72757); // display  727.50000000 Hz
    assert.equal(encodeGenXFrequency(440), 4408); // display  440.00000000 Hz
    assert.equal(encodeGenXFrequency(2000), 20008); // display 2000.00000000 Hz
  });

  it("packs the exponent code in the last digit", () => {
    // Whole hertz → exponent code 8; one decimal → 7; etc.
    assert.equal(encodeGenXFrequency(1) % 10, 8);
    assert.equal(encodeGenXFrequency(0.1) % 10, 7);
    assert.equal(encodeGenXFrequency(0.01) % 10, 6);
  });

  it("round-trips through the device's decode formula", () => {
    for (const hz of [440, 727.5, 1000, 2000, 20000, 0.5, 3.125]) {
      assert.ok(
        Math.abs(decodeGenXFrequency(encodeGenXFrequency(hz)) - hz) < 1e-9,
        `${hz} Hz did not round-trip`,
      );
    }
  });

  it("clamps a negative frequency to zero", () => {
    assert.equal(encodeGenXFrequency(-5), 8); // 0 → mantissa 0, code 8
  });
});

describe("amplitudeRegisterValue", () => {
  it("converts peak-to-peak volts to peak centivolts (vpp × 50)", () => {
    assert.equal(amplitudeRegisterValue(5), 250);
    assert.equal(amplitudeRegisterValue(3.3), 165);
    assert.equal(amplitudeRegisterValue(-1), 0);
  });
});
