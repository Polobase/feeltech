import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FY2300_WAVEFORMS,
  FY6900_AUX_WAVEFORMS,
  FY6900_MAIN_WAVEFORMS,
  listWaveforms,
  resolveWaveform,
  waveformName,
} from "../src/waveforms.js";
import { Channel } from "../src/types.js";

describe("resolveWaveform", () => {
  it("passes numeric codes through", () => {
    assert.equal(resolveWaveform("FY6900", Channel.Main, 5), 5);
  });

  it("resolves names case-insensitively", () => {
    assert.equal(resolveWaveform("FY6900", Channel.Main, "Sine"), 0);
    assert.equal(resolveWaveform("FY6900", Channel.Main, "sine"), 0);
    assert.equal(resolveWaveform("FY6900", Channel.Main, "SQUARE"), 1);
  });

  it("reflects the missing Adj-Pulse on CH2", () => {
    assert.equal(resolveWaveform("FY6900", Channel.Main, "Adj-Pulse"), 5);
    assert.equal(resolveWaveform("FY6900", Channel.Main, "DC"), 6);
    assert.equal(resolveWaveform("FY6900", Channel.Aux, "DC"), 5);
    assert.throws(() => resolveWaveform("FY6900", Channel.Aux, "Adj-Pulse"));
  });

  it("resolves arbitrary slots per family and channel", () => {
    assert.equal(resolveWaveform("FY6900", Channel.Main, "Arbitrary1"), 37);
    assert.equal(resolveWaveform("FY6900", Channel.Aux, "Arbitrary1"), 36);
    assert.equal(resolveWaveform("FY6900", Channel.Main, "Arbitrary64"), 100);
    assert.equal(resolveWaveform("FY2300", Channel.Main, "Arbitrary1"), 31);
    assert.equal(resolveWaveform("FY2300", Channel.Main, "Arbitrary16"), 46);
  });

  it("rejects out-of-range arbitrary slots", () => {
    assert.throws(() => resolveWaveform("FY2300", Channel.Main, "Arbitrary17"));
    assert.throws(() => resolveWaveform("FY6900", Channel.Main, "Arbitrary65"));
    assert.throws(() => resolveWaveform("FY6900", Channel.Main, "Arbitrary0"));
  });

  it("rejects unknown names", () => {
    assert.throws(() => resolveWaveform("FY6900", Channel.Main, "NotAWave"));
  });
});

describe("waveformName", () => {
  it("maps codes back to names, including arbitrary slots", () => {
    assert.equal(waveformName("FY6900", Channel.Main, 0), "Sine");
    assert.equal(waveformName("FY6900", Channel.Main, 37), "Arbitrary1");
    assert.equal(waveformName("FY6900", Channel.Aux, 36), "Arbitrary1");
    assert.equal(waveformName("FY2300", Channel.Main, 31), "Arbitrary1");
    assert.equal(waveformName("FY6900", Channel.Main, 999), "Unknown(999)");
  });

  it("round-trips every built-in waveform", () => {
    for (const [family, channel, table] of [
      ["FY2300", Channel.Main, FY2300_WAVEFORMS],
      ["FY6900", Channel.Main, FY6900_MAIN_WAVEFORMS],
      ["FY6900", Channel.Aux, FY6900_AUX_WAVEFORMS],
    ] as const) {
      table.forEach((name, code) => {
        assert.equal(resolveWaveform(family, channel, name), code);
        assert.equal(waveformName(family, channel, code), name);
      });
    }
  });
});

describe("listWaveforms", () => {
  it("lists built-ins plus arbitrary slots", () => {
    const fy2300 = listWaveforms("FY2300", Channel.Main);
    assert.equal(fy2300.length, FY2300_WAVEFORMS.length + 16);
    const main = listWaveforms("FY6900", Channel.Main);
    assert.equal(main.length, FY6900_MAIN_WAVEFORMS.length + 64);
    const aux = listWaveforms("FY6900", Channel.Aux);
    assert.equal(aux.length, FY6900_AUX_WAVEFORMS.length + 64);
    assert.deepEqual(main[37], {
      code: 37,
      name: "Arbitrary1",
      arbitrary: true,
      arbitrarySlot: 1,
    });
  });
});
