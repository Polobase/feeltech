import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { amplitudeRegisterValue, channelSlot } from "../src/genx-wire.js";

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
