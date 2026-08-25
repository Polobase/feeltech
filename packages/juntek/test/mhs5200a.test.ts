import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RecordingTransport } from "@freqgen/core/testing";
import { Mhs5200a } from "../src/mhs5200a.js";
import { JUNTEK_DEVICES } from "../src/devices.js";
import { DeviceRegistry } from "@freqgen/core";

async function mhs(options = {}) {
  const transport = new RecordingTransport({ defaultResponse: "ok" });
  const device = new Mhs5200a(transport, { commandDelayMs: 0, ...options });
  await device.open();
  transport.clear();
  return { transport, device };
}

describe("Mhs5200a link setup", () => {
  it("opens at 57600 8N1", async () => {
    const transport = new RecordingTransport({ defaultResponse: "ok" });
    await new Mhs5200a(transport, { commandDelayMs: 0 }).open();
    assert.deepEqual(transport.openOptions, {
      baudRate: 57600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
  });

  it("pins the attenuator to 0 dB so amplitude means volts", async () => {
    // Without this the same number would mean different things depending on
    // how the front panel was left.
    const transport = new RecordingTransport({ defaultResponse: "ok" });
    await new Mhs5200a(transport, { commandDelayMs: 0 }).open();
    assert.deepEqual(transport.writes, [":s1y1\n", ":s2y1\n"]);
  });
});

describe("Mhs5200a encodings", () => {
  it("numbers channels from 1 on the wire", async () => {
    const { transport, device } = await mhs();
    await device.setFrequency(0, 1000);
    await device.setFrequency(1, 1000);
    assert.deepEqual(transport.writes, [":s1f100000\n", ":s2f100000\n"]);
  });

  it("sends frequency as centihertz", async () => {
    const { transport, device } = await mhs();
    await device.setFrequency(0, 727.5);
    assert.deepEqual(transport.writes, [":s1f72750\n"]);
  });

  it("biases offset by 120 as a percentage of amplitude", async () => {
    const { transport, device } = await mhs();
    await device.setOffsetRatio(0, 0);
    await device.setOffsetRatio(0, 1);
    await device.setOffsetRatio(0, -1);
    assert.deepEqual(transport.writes, [":s1o120\n", ":s1o220\n", ":s1o20\n"]);
  });

  it("clamps an out-of-range offset ratio", async () => {
    const { transport, device } = await mhs();
    await device.setOffsetRatio(0, 3);
    assert.deepEqual(transport.writes, [":s1o220\n"]);
  });

  it("sends duty at 0.1 % and phase in whole degrees", async () => {
    const { transport, device } = await mhs();
    await device.setDutyCycle(0, 12.5);
    await device.setPhase(0, 450);
    assert.deepEqual(transport.writes, [":s1d125\n", ":s1p90\n"]);
  });

  it("rejects an amplitude beyond the device's 20 V range", async () => {
    const { device } = await mhs();
    await assert.rejects(device.setAmplitude(0, 25), /between 0 and 20/);
  });
});

describe("Mhs5200a global output switch", () => {
  it("reports that output is not per-channel", async () => {
    const { device } = await mhs();
    assert.equal(device.capabilities.perChannelOutput, false);
  });

  it("keeps the global switch on while either channel wants output", async () => {
    const { transport, device } = await mhs();
    await device.setAmplitude(0, 5);
    await device.setAmplitude(1, 8);
    transport.clear();

    await device.setOutput(0, true);
    // Channel amplitude restored, then the global switch on.
    assert.deepEqual(transport.writes, [":s1a500\n", ":s1b1\n"]);

    transport.clear();
    await device.setOutput(1, true);
    assert.deepEqual(transport.writes, [":s2a800\n", ":s1b1\n"]);

    transport.clear();
    await device.setOutput(0, false);
    // CH1 silenced by amplitude, but the switch stays on for CH2.
    assert.deepEqual(transport.writes, [":s1a0\n", ":s1b1\n"]);

    transport.clear();
    await device.setOutput(1, false);
    // Now nothing wants output, so the switch goes off too.
    assert.deepEqual(transport.writes, [":s2a0\n", ":s1b0\n"]);
  });

  it("holds amplitude back while a channel is muted", async () => {
    const { transport, device } = await mhs();
    await device.setAmplitude(0, 5);
    assert.deepEqual(transport.writes, []);
    await device.setOutput(0, true);
    transport.clear();
    await device.setAmplitude(0, 7);
    assert.deepEqual(transport.writes, [":s1a700\n"]);
  });

  it("converts a volt offset against the channel amplitude", async () => {
    const { transport, device } = await mhs();
    await device.setAmplitude(0, 20);
    transport.clear();
    await device.setOffset(0, 10); // half of 20 Vpp → ratio +1
    assert.deepEqual(transport.writes, [":s1o220\n"]);
  });

  it("allows a zero offset even with no amplitude set", async () => {
    const { transport, device } = await mhs();
    await device.setOffset(0, 0);
    assert.deepEqual(transport.writes, [":s1o120\n"]);
    await assert.rejects(device.setOffset(0, 1), /set an amplitude first/);
  });
});

describe("Mhs5200a waveforms", () => {
  it("maps slot 3 to a rising ramp, unlike the JDS6600", async () => {
    const { device } = await mhs();
    const applied = await device.setWaveform(0, "ramp-up");
    assert.equal(applied.substituted, false);
    assert.equal(applied.code, 3);
    assert.equal((await device.setWaveform(0, "triangle")).code, 2);
  });
});

describe("JUNTEK_DEVICES", () => {
  it("registers every model in the family", () => {
    const registry = new DeviceRegistry().registerAll(JUNTEK_DEVICES);
    assert.deepEqual(
      registry.list().map((d) => d.id).sort(),
      ["cjds66", "jds2800", "jds2900", "jds6600", "jds8000", "mhs5200a"],
    );
  });

  it("attributes the rebadges to the brand they are sold under", () => {
    const byId = Object.fromEntries(JUNTEK_DEVICES.map((d) => [d.id, d]));
    assert.equal(byId["jds6600"]!.vendor, "JUNTEK");
    assert.equal(byId["cjds66"]!.vendor, "Koolertron");
    assert.equal(byId["mhs5200a"]!.vendor, "Koolertron");
  });

  it("marks every driver unverified, with a note", () => {
    for (const d of JUNTEK_DEVICES) {
      assert.equal(d.verified, false, `${d.id} claims verification it does not have`);
      assert.ok(d.note && d.note.length > 0, `${d.id} has no note`);
    }
  });
});
