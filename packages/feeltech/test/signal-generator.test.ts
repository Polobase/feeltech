import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FeelTech, Channel } from "../src/feeltech.js";
import { MockTransport } from "../src/testing.js";

async function connected(family: "FY2300" | "FY6900" = "FY6900") {
  const mock = new MockTransport({ family });
  const fy = new FeelTech(mock, { family });
  await fy.open();
  mock.writes.length = 0;
  return { mock, fy };
}

describe("applyStep", () => {
  it("emits byte-identical traffic to configureChannel", async () => {
    // The whole point of applyStep on the FY series is that it is a rename, not
    // a new code path — so the wire traffic must not budge.
    const a = await connected();
    await a.fy.applyStep(Channel.Main, {
      waveform: "sine",
      frequencyHz: 1000,
      amplitudeVpp: 3.3,
      offsetV: 0,
      dutyCyclePct: 50,
      phaseDeg: 0,
      output: true,
    });

    const b = await connected();
    await b.fy.configureChannel(Channel.Main, {
      waveform: "sine",
      frequencyHz: 1000,
      amplitudeV: 3.3,
      offsetV: 0,
      dutyCyclePct: 50,
      phaseDeg: 0,
      enabled: true,
    });

    assert.deepEqual(a.mock.writes, b.mock.writes);
    assert.ok(a.mock.writes.includes("WMF00001000.000000\n"));
  });

  it("skips omitted fields", async () => {
    const { mock, fy } = await connected();
    await fy.applyStep(Channel.Aux, { frequencyHz: 440 });
    assert.deepEqual(
      mock.writes.filter((w) => w.startsWith("WF")),
      ["WFF00000440.000000\n"],
    );
  });

  it("turns the output on last, after the parameters are in place", async () => {
    const { mock, fy } = await connected();
    await fy.applyStep(Channel.Main, { output: true, frequencyHz: 2000 });
    const writes = mock.writes.filter((w) => w.startsWith("WM"));
    assert.ok(
      writes.indexOf("WMN1\n") > writes.indexOf("WMF00002000.000000\n"),
      `expected output enable after frequency, got ${JSON.stringify(writes)}`,
    );
  });
});

describe("setWaveform with generic kinds", () => {
  it("maps a kind to this family's code and reports no substitution", async () => {
    const { fy } = await connected();
    const applied = await fy.setWaveform(Channel.Main, "ramp-down");
    assert.deepEqual(applied, {
      requested: "ramp-down",
      actual: "ramp-down",
      substituted: false,
      code: 9, // FY6900 main table: NegRamp
    });
  });

  it("accounts for the CH2 code shift from the missing Adj-Pulse entry", async () => {
    const { fy } = await connected();
    const main = await fy.setWaveform(Channel.Main, "triangle");
    const aux = await fy.setWaveform(Channel.Aux, "triangle");
    assert.equal(main.code, 7);
    assert.equal(aux.code, 6);
  });

  it("maps kinds onto the quite different FY2300 table", async () => {
    const { fy } = await connected("FY2300");
    assert.equal((await fy.setWaveform(Channel.Main, "square")).code, 1); // Rectangular
    assert.equal((await fy.setWaveform(Channel.Main, "ramp-up")).code, 3); // Rise Sawtooth
    assert.equal((await fy.setWaveform(Channel.Main, "ramp-down")).code, 4); // Fall Sawtooth
  });

  it("substitutes rather than fails where a family has no equivalent", async () => {
    // The FY2300 table has no constant-level (DC) entry.
    const { fy } = await connected("FY2300");
    const applied = await fy.setWaveform(Channel.Main, "dc");
    assert.equal(applied.requested, "dc");
    assert.equal(applied.substituted, true);
    assert.equal(applied.actual, "sine");
  });

  it("still accepts FY names and raw codes, reporting the matching kind", async () => {
    const { fy } = await connected();
    assert.equal((await fy.setWaveform(Channel.Main, "NegRamp")).code, 9);
    assert.equal((await fy.setWaveform(Channel.Main, "Arbitrary1")).code, 37);
    const raw = await fy.setWaveform(Channel.Main, 8);
    assert.equal(raw.code, 8);
    assert.equal(raw.actual, "ramp-up"); // code 8 is Ramp
    assert.equal(raw.substituted, false);
  });

  it("reports codes with no generic name as custom", async () => {
    const { fy } = await connected();
    const applied = await fy.setWaveform(Channel.Main, "ECG");
    assert.equal(applied.actual, "custom");
    assert.equal(applied.substituted, false);
  });
});

describe("capabilities and info", () => {
  it("derives limits from the model the device reported", async () => {
    const mock = new MockTransport({ family: "FY6900", model: "FY6300-60M" });
    const fy = new FeelTech(mock, { family: "FY6900" });
    await fy.open();

    assert.equal(fy.info.vendor, "FeelTech");
    assert.equal(fy.info.model, "FY6300-60M");
    assert.equal(fy.capabilities.limits.sine.maxHz, 60e6);
    assert.equal(fy.capabilities.limits.square.maxHz, null);
    assert.equal(fy.capabilities.readback, true);
    assert.equal(fy.capabilities.channels, 2);
  });

  it("lists the generic kinds the family can produce", async () => {
    const { fy } = await connected();
    assert.deepEqual([...fy.capabilities.waveforms].sort(), [
      "custom",
      "dc",
      "noise",
      "ramp-down",
      "ramp-up",
      "sine",
      "square",
      "triangle",
    ]);

    const old = await connected("FY2300");
    assert.equal(old.fy.capabilities.waveforms.includes("dc"), false);
  });
});
