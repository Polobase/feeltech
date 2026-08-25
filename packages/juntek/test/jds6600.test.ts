import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RecordingTransport } from "@freqgen/core/testing";
import { Jds6600 } from "../src/jds6600.js";

async function jds(options = {}) {
  const transport = new RecordingTransport({ defaultResponse: ":ok" });
  const device = new Jds6600(transport, { commandDelayMs: 0, ...options });
  await device.open();
  transport.clear();
  return { transport, device };
}

describe("Jds6600 link setup", () => {
  it("opens the port at the documented framing", async () => {
    const transport = new RecordingTransport({ defaultResponse: ":ok" });
    await new Jds6600(transport, { commandDelayMs: 0 }).open();
    assert.deepEqual(transport.openOptions, {
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
  });

  it("labels a CJDS66 as the Koolertron rebadge it is", async () => {
    const { device } = await jds({ model: "CJDS66" });
    assert.deepEqual(device.info, { vendor: "Koolertron", model: "CJDS66" });
  });

  it("labels the JUNTEK-branded models as JUNTEK", async () => {
    const { device } = await jds({ model: "JDS2900" });
    assert.deepEqual(device.info, { vendor: "JUNTEK", model: "JDS2900" });
  });
});

describe("Jds6600 encodings", () => {
  it("sends frequency as centihertz with the hertz unit code", async () => {
    const { transport, device } = await jds();
    await device.setFrequency(0, 1000);
    await device.setFrequency(1, 727.5);
    assert.deepEqual(transport.writes, [":w23=100000,0.\r\n", ":w24=72750,0.\r\n"]);
  });

  it("sends amplitude in millivolts", async () => {
    const { transport, device } = await jds();
    await device.setAmplitude(0, 5);
    await device.setAmplitude(1, 3.3);
    assert.deepEqual(transport.writes, [":w25=5000.\r\n", ":w26=3300.\r\n"]);
  });

  it("biases offset by 1000 in 10 mV units", async () => {
    const { transport, device } = await jds();
    await device.setOffset(0, 0);
    await device.setOffset(0, 1);
    await device.setOffset(0, -1);
    assert.deepEqual(transport.writes, [
      ":w27=1000.\r\n",
      ":w27=1100.\r\n",
      ":w27=900.\r\n",
    ]);
  });

  it("sends duty at 0.1 % resolution", async () => {
    const { transport, device } = await jds();
    await device.setDutyCycle(1, 12.5);
    assert.deepEqual(transport.writes, [":w30=125.\r\n"]);
  });

  it("uses the single phase register regardless of channel", async () => {
    const { transport, device } = await jds();
    await device.setPhase(0, 90);
    await device.setPhase(1, 90);
    assert.deepEqual(transport.writes, [":w31=900.\r\n", ":w31=900.\r\n"]);
  });

  it("rejects a negative frequency", async () => {
    const { device } = await jds();
    await assert.rejects(device.setFrequency(0, -1), /frequency must be >= 0/);
  });
});

describe("Jds6600 output register", () => {
  it("re-sends the other channel's state, because register 20 carries both", async () => {
    const { transport, device } = await jds();
    await device.setOutput(0, true);
    assert.deepEqual(transport.writes, [":w20=1,0.\r\n"]);

    transport.clear();
    await device.setOutput(1, true);
    assert.deepEqual(transport.writes, [":w20=1,1.\r\n"]);

    transport.clear();
    await device.setOutput(0, false);
    assert.deepEqual(transport.writes, [":w20=0,1.\r\n"]);
  });

  it("clears both outputs on close so the tracked state cannot go stale", async () => {
    const { transport, device } = await jds();
    await device.setOutput(0, true);
    transport.clear();
    await device.close();
    assert.deepEqual(transport.writes, [":w20=0,0.\r\n"]);
  });
});

describe("Jds6600 waveforms", () => {
  it("maps the established slots", async () => {
    const { transport, device } = await jds();
    assert.equal((await device.setWaveform(0, "sine")).code, 0);
    assert.equal((await device.setWaveform(1, "square")).code, 1);
    assert.deepEqual(transport.writes, [":w21=0.\r\n", ":w22=1.\r\n"]);
  });

  it("reports a sawtooth as substituted — slot 3 is a triangle here", async () => {
    // Not a pedantic distinction: the Spooky2 contact shells want the
    // asymmetric shape, and a triangle is not it.
    const { device } = await jds();
    const applied = await device.setWaveform(0, "ramp-up");
    assert.equal(applied.requested, "ramp-up");
    assert.equal(applied.actual, "triangle");
    assert.equal(applied.substituted, true);
    assert.equal(applied.code, 3);
  });
});

describe("Jds6600 acknowledgement handling", () => {
  it("carries on when the unit skips an ack", async () => {
    const transport = new RecordingTransport();
    const device = new Jds6600(transport, { commandDelayMs: 0, ackTimeoutMs: 10 });
    await device.open();
    await device.setFrequency(0, 1000);
    assert.deepEqual(transport.writes, [":w23=100000,0.\r\n"]);
  });

  it("throws under strictAck", async () => {
    const transport = new RecordingTransport();
    const device = new Jds6600(transport, {
      commandDelayMs: 0,
      ackTimeoutMs: 10,
      strictAck: true,
    });
    await device.open();
    await assert.rejects(device.setFrequency(0, 1000), /No acknowledgement/);
  });
});

describe("Jds6600 applyStep", () => {
  it("configures a channel and enables output last", async () => {
    const { transport, device } = await jds();
    await device.applyStep(0, {
      waveform: "square",
      frequencyHz: 1000,
      amplitudeVpp: 5,
      offsetV: 0,
      dutyCyclePct: 50,
      output: true,
    });
    assert.deepEqual(transport.writes, [
      ":w21=1.\r\n",
      ":w23=100000,0.\r\n",
      ":w25=5000.\r\n",
      ":w27=1000.\r\n",
      ":w29=500.\r\n",
      ":w20=1,0.\r\n",
    ]);
  });
});
