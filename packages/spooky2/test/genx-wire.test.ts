import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  amplitudeRegisterValue,
  armRegisterValue,
  channelSlot,
  displayRegisterValue,
} from "../src/genx-wire.js";

describe("armRegisterValue", () => {
  it("encodes whole hertz with exponent code 8", () => {
    assert.equal(armRegisterValue(64), 648);
    assert.equal(armRegisterValue(440), 4408);
    assert.equal(armRegisterValue(1), 18);
  });

  it("shifts the exponent code down for each decimal place needed", () => {
    assert.equal(armRegisterValue(727.5), 72757);
    assert.equal(armRegisterValue(0.25), 256);
  });

  it("round-trips through the documented display formula", () => {
    // display = floor(v / 10) × 10^((v mod 10) − 8)
    for (const hz of [64, 440, 727.5, 0.25, 20000]) {
      const v = armRegisterValue(hz);
      const decoded = Math.floor(v / 10) * 10 ** ((v % 10) - 8);
      assert.ok(
        Math.abs(decoded - hz) < 1e-9,
        `${hz} Hz encoded as ${v} decoded back to ${decoded}`,
      );
    }
  });

  it("clamps a negative frequency to zero", () => {
    assert.equal(armRegisterValue(-5), 8);
  });
});

describe("displayRegisterValue", () => {
  it("passes whole hertz through unscaled", () => {
    assert.equal(displayRegisterValue(1000), 1000);
  });

  it("uses centihertz when two decimal places suffice", () => {
    assert.equal(displayRegisterValue(727.5), 72750);
    assert.equal(displayRegisterValue(0.25), 25);
  });

  it("falls back to hundred-thousandths for finer values", () => {
    assert.equal(displayRegisterValue(1.000005), 100001);
  });
});

describe("channelSlot", () => {
  it("fills the first field for channel 0 and the second for channel 1", () => {
    assert.equal(channelSlot(0, 14), "14,,");
    assert.equal(channelSlot(1, 14), ",14,");
  });
});

describe("amplitudeRegisterValue", () => {
  it("converts volts to centivolts", () => {
    assert.equal(amplitudeRegisterValue(5), 500);
    assert.equal(amplitudeRegisterValue(3.3), 330);
    assert.equal(amplitudeRegisterValue(-1), 0);
  });
});
