import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RecordingTransport } from "@freqgen/core/testing";
import { Spooky2XM, XM_RANGE_BOUNDARY_HZ } from "../src/xm.js";

async function xm(options = {}) {
  const transport = new RecordingTransport({ defaultResponse: "ok" });
  const device = new Spooky2XM(transport, options);
  await device.open();
  transport.clear();
  return { transport, device };
}

describe("Spooky2XM link setup", () => {
  it("opens the port at the documented framing", async () => {
    const transport = new RecordingTransport({ defaultResponse: "ok" });
    await new Spooky2XM(transport).open();
    assert.deepEqual(transport.openOptions, {
      baudRate: 57600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
  });
});

describe("Spooky2XM frequency ranging", () => {
  it("uses the coarse range at and above the boundary", async () => {
    const { transport, device } = await xm();
    await device.setFrequency(0, 440);
    await device.setFrequency(0, XM_RANGE_BOUNDARY_HZ);
    // 440 Hz is below the boundary → fine range (scale 1, counts of 10 µHz).
    // 600 Hz is at it → coarse range (scale 0, counts of 10 mHz).
    assert.deepEqual(transport.writes, [
      ":w631\r\n",
      ":w2344000000\r\n",
      ":w630\r\n",
      ":w2360000\r\n",
    ]);
  });

  it("writes the scale register only when the range actually changes", async () => {
    const { transport, device } = await xm();
    await device.setFrequency(0, 1000);
    await device.setFrequency(0, 2000);
    await device.setFrequency(0, 3000);
    assert.deepEqual(transport.writes, [
      ":w630\r\n",
      ":w23100000\r\n",
      ":w23200000\r\n",
      ":w23300000\r\n",
    ]);
  });

  it("switches back down across the boundary", async () => {
    const { transport, device } = await xm();
    await device.setFrequency(0, 1000);
    transport.clear();
    await device.setFrequency(0, 100);
    assert.deepEqual(transport.writes, [":w631\r\n", ":w2310000000\r\n"]);
  });

  it("tracks the two channels' ranges independently", async () => {
    const { transport, device } = await xm();
    await device.setFrequency(0, 1000);
    await device.setFrequency(1, 100);
    assert.deepEqual(transport.writes, [
      ":w630\r\n",
      ":w23100000\r\n",
      ":w641\r\n",
      ":w2410000000\r\n",
    ]);
  });

  it("rejects a negative frequency", async () => {
    const { device } = await xm();
    await assert.rejects(device.setFrequency(0, -1), /frequency must be >= 0/);
  });
});

describe("Spooky2XM parameters", () => {
  it("addresses CH2 by adding one to the register base", async () => {
    const { transport, device } = await xm();
    await device.setAmplitude(1, 20);
    await device.setDutyCycle(1, 50);
    await device.setPhase(1, 180);
    await device.setOutput(1, true);
    assert.deepEqual(transport.writes, [
      ":w262000\r\n",
      ":w30500\r\n",
      ":w32180\r\n",
      ":w621\r\n",
    ]);
  });

  it("encodes amplitude in centivolts", async () => {
    const { transport, device } = await xm();
    await device.setAmplitude(0, 3.3);
    assert.deepEqual(transport.writes, [":w25330\r\n"]);
  });

  it("encodes offset as a fraction of amplitude, biased by 100", async () => {
    const { transport, device } = await xm();
    // Spooky2's "100 % offset" — a fully positive waveform — is ratio +1.
    await device.setOffsetRatio(0, 1);
    await device.setOffsetRatio(0, 0);
    await device.setOffsetRatio(0, -1);
    assert.deepEqual(transport.writes, [":w27200\r\n", ":w27100\r\n", ":w270\r\n"]);
  });

  it("converts a volt offset using the amplitude last written", async () => {
    const { transport, device } = await xm();
    await device.setAmplitude(0, 20);
    transport.clear();
    // Half of 20 Vpp is 10 V, so +10 V is a full +1 ratio.
    await device.setOffset(0, 10);
    await device.setOffset(0, 5);
    assert.deepEqual(transport.writes, [":w27200\r\n", ":w27150\r\n"]);
  });

  it("clamps an out-of-range offset ratio instead of emitting nonsense", async () => {
    const { transport, device } = await xm();
    await device.setOffsetRatio(0, 5);
    assert.deepEqual(transport.writes, [":w27200\r\n"]);
  });

  it("refuses a volt offset when no amplitude can be inferred", async () => {
    const { device } = await xm();
    await device.setAmplitude(0, 0);
    await assert.rejects(device.setOffset(0, 1), /set an amplitude first/);
  });

  it("normalises phase into 0–359", async () => {
    const { transport, device } = await xm();
    await device.setPhase(0, 450);
    await device.setPhase(0, -90);
    assert.deepEqual(transport.writes, [":w3190\r\n", ":w31270\r\n"]);
  });

  it("drives sync through the non-per-channel register", async () => {
    const { transport, device } = await xm();
    await device.setSync(true);
    assert.deepEqual(transport.writes, [":w681\r\n"]);
  });

  it("rejects a channel the device does not have", async () => {
    const { device } = await xm();
    await assert.rejects(device.setOutput(2, true), /channels 0 and 1/);
  });
});

describe("Spooky2XM waveforms", () => {
  it("maps the corroborated slots directly", async () => {
    const { transport, device } = await xm();
    assert.equal((await device.setWaveform(0, "sine")).code, 0);
    assert.equal((await device.setWaveform(0, "square")).code, 1);
    assert.deepEqual(transport.writes, [":w210\r\n", ":w211\r\n"]);
  });

  it("substitutes a shape the XM does not have, and says so", async () => {
    const { device } = await xm();
    const applied = await device.setWaveform(0, "triangle");
    assert.equal(applied.requested, "triangle");
    assert.equal(applied.substituted, true);
    // Slot 2's ramp keeps the linear slopes a triangle has.
    assert.equal(applied.actual, "ramp-up");
    assert.equal(applied.code, 2);
  });

  it("passes a raw slot number through untouched", async () => {
    const { transport, device } = await xm();
    const applied = await device.setWaveform(1, 3);
    assert.equal(applied.code, 3);
    assert.equal(applied.substituted, false);
    assert.deepEqual(transport.writes, [":w223\r\n"]);
  });
});

describe("Spooky2XM acknowledgement handling", () => {
  it("carries on when the unit skips an ack", async () => {
    const transport = new RecordingTransport(); // silent: no defaultResponse
    const device = new Spooky2XM(transport, { ackTimeoutMs: 10 });
    await device.open();
    await device.setFrequency(0, 1000);
    assert.deepEqual(transport.writes, [":w630\r\n", ":w23100000\r\n"]);
  });

  it("throws on a missing ack under strictAck", async () => {
    const transport = new RecordingTransport();
    const device = new Spooky2XM(transport, { ackTimeoutMs: 10, strictAck: true });
    await device.open();
    await assert.rejects(device.setOutput(0, true), /No acknowledgement/);
  });
});

describe("Spooky2XM applyStep", () => {
  it("configures a channel and turns it on last", async () => {
    const { transport, device } = await xm();
    await device.applyStep(0, {
      waveform: "square",
      frequencyHz: 727.5,
      amplitudeVpp: 20,
      dutyCyclePct: 50,
      output: true,
    });
    assert.deepEqual(transport.writes, [
      ":w211\r\n",
      ":w630\r\n",
      ":w2372750\r\n",
      ":w252000\r\n",
      ":w29500\r\n",
      ":w611\r\n",
    ]);
  });
});
