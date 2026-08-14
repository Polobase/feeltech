import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RecordingTransport } from "@freqgen/core/testing";
import { FY3200S } from "../src/fy3200s.js";

async function fy(options = {}) {
  const transport = new RecordingTransport();
  const device = new FY3200S(transport, { commandDelayMs: 0, ...options });
  await device.open();
  transport.clear();
  return { transport, device };
}

describe("FY3200S link setup", () => {
  it("opens at 9600 8N1, not the FY6900 family's 115200 8N2", async () => {
    const transport = new RecordingTransport();
    await new FY3200S(transport, { commandDelayMs: 0 }).open();
    assert.deepEqual(transport.openOptions, {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
  });
});

describe("FY3200S framing", () => {
  it("prefixes CH1 with b and CH2 with d", async () => {
    const { transport, device } = await fy();
    await device.setFrequency(0, 1000);
    await device.setFrequency(1, 1000);
    assert.deepEqual(transport.writes, ["bf100000\n", "df100000\n"]);
  });

  it("encodes frequency in centihertz", async () => {
    const { transport, device } = await fy();
    await device.setFrequency(0, 727.5);
    assert.deepEqual(transport.writes, ["bf72750\n"]);
  });

  it("uses the integer duty format this model needs, not the WMD decimal form", async () => {
    // bd500 = 50 %. Sending the FY2300-family "50.0" here is silently ignored.
    const { transport, device } = await fy();
    await device.setDutyCycle(0, 50);
    await device.setDutyCycle(0, 12.5);
    assert.deepEqual(transport.writes, ["bd500\n", "bd125\n"]);
  });

  it("writes phase on the CH2 register whichever channel is asked", async () => {
    const { transport, device } = await fy();
    await device.setPhase(0, 90);
    assert.deepEqual(transport.writes, ["dp90\n"]);
  });

  it("normalises phase into 0–359", async () => {
    const { transport, device } = await fy();
    await device.setPhase(1, -90);
    assert.deepEqual(transport.writes, ["dp270\n"]);
  });
});

describe("FY3200S output gating", () => {
  it("reports that it has no output relay", async () => {
    const { device } = await fy();
    assert.equal(device.capabilities.outputRelay, false);
  });

  it("switches output by writing the amplitude", async () => {
    const { transport, device } = await fy();
    await device.setAmplitude(0, 5);
    // Amplitude while off is only remembered — writing it would be
    // indistinguishable from switching the output on.
    assert.deepEqual(transport.writes, []);

    await device.setOutput(0, true);
    assert.deepEqual(transport.writes, ["ba5.000\n"]);

    transport.clear();
    await device.setOutput(0, false);
    assert.deepEqual(transport.writes, ["ba0.000\n"]);
  });

  it("does not resurrect a stale level when switching back on", async () => {
    const { transport, device } = await fy();
    await device.setOutput(0, true);
    transport.clear();
    await device.setAmplitude(0, 2.5); // live: written through
    await device.setOutput(0, false);
    await device.setAmplitude(0, 7.5); // off: remembered only
    transport.clear();
    await device.setOutput(0, true);
    assert.deepEqual(transport.writes, ["ba7.500\n"]);
  });

  it("keeps the two channels' output states independent", async () => {
    const { transport, device } = await fy();
    await device.setAmplitude(0, 3);
    await device.setAmplitude(1, 8);
    await device.setOutput(1, true);
    assert.deepEqual(transport.writes, ["da8.000\n"]);
  });
});

describe("FY3200S waveforms", () => {
  it("maps the established slots", async () => {
    const { transport, device } = await fy();
    assert.equal((await device.setWaveform(0, "sine")).code, 0);
    assert.equal((await device.setWaveform(0, "square")).code, 1);
    assert.equal((await device.setWaveform(0, "ramp-up")).code, 3);
    assert.deepEqual(transport.writes, ["bw0\n", "bw1\n", "bw3\n"]);
  });

  it("substitutes an unmapped shape and says so", async () => {
    const { device } = await fy();
    const applied = await device.setWaveform(0, "triangle");
    assert.equal(applied.substituted, true);
    assert.equal(applied.actual, "ramp-up");
  });

  it("accepts a raw slot in the range the command allows", async () => {
    const { transport, device } = await fy();
    await device.setWaveform(0, 17);
    assert.deepEqual(transport.writes, ["bw17\n"]);
    await assert.rejects(device.setWaveform(0, 100), /0\.\.99/);
  });
});

describe("FY3200S applyStep", () => {
  it("configures a channel and gates the output on last", async () => {
    const { transport, device } = await fy();
    await device.applyStep(0, {
      waveform: "square",
      frequencyHz: 1000,
      amplitudeVpp: 5,
      dutyCyclePct: 50,
      output: true,
    });
    assert.deepEqual(transport.writes, [
      "bw1\n",
      "bf100000\n",
      // amplitude is held back while the channel is off …
      "bd500\n",
      // … and applied by the output gate
      "ba5.000\n",
    ]);
  });
});
