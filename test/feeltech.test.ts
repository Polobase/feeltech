import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FeelTech } from "../src/feeltech.js";
import {
  Channel,
  FeelTechError,
  FeelTechVerifyError,
  GateTime,
  ModulationMode,
  SweepMode,
  SweepObject,
} from "../src/types.js";
import { MockTransport } from "../src/testing.js";

async function openFy6900(
  mock = new MockTransport({ family: "FY6900" }),
): Promise<{ fy: FeelTech; mock: MockTransport }> {
  const fy = new FeelTech(mock);
  await fy.open();
  return { fy, mock };
}

async function openFy2300(): Promise<{ fy: FeelTech; mock: MockTransport }> {
  const mock = new MockTransport({ family: "FY2300" });
  const fy = new FeelTech(mock, { family: "FY2300" });
  await fy.open();
  return { fy, mock };
}

describe("open handshake", () => {
  it("detects the FY6900 family from the UMO model string", async () => {
    const { fy } = await openFy6900();
    assert.equal(fy.deviceModel, "FY6300-60M");
    assert.equal(fy.family, "FY6900");
    assert.equal(fy.deviceId, "12345678");
  });

  it("opens with 2 stop bits and 115200 baud by default", async () => {
    const { mock } = await openFy6900();
    assert.equal(mock.openOptions?.stopBits, 2);
    assert.equal(mock.openOptions?.baudRate, 115200);
  });

  it("opens FY2300 with 1 stop bit and 9600 baud", async () => {
    const { mock } = await openFy2300();
    assert.equal(mock.openOptions?.stopBits, 1);
    assert.equal(mock.openOptions?.baudRate, 9600);
  });
});

describe("channel commands (wire format)", () => {
  it("setFrequency writes the %015.6f form on FY6900", async () => {
    const { fy, mock } = await openFy6900();
    await fy.setFrequency(Channel.Main, 1000);
    assert.ok(mock.writes.includes("WMF00001000.000000\n"));
  });

  it("setFrequency honours the uHz encoding override", async () => {
    const mock = new MockTransport({ family: "FY6900" });
    const fy = new FeelTech(mock, { frequencyEncoding: "uHz" });
    await fy.open();
    await fy.setFrequency(Channel.Main, 1000);
    assert.ok(mock.writes.includes("WMF00001000000000\n"));
  });

  it("uses the F-prefix for the aux channel", async () => {
    const { fy, mock } = await openFy6900();
    await fy.setAmplitude(Channel.Aux, 3.3);
    assert.ok(mock.writes.includes("WFA3.3000\n"));
  });

  it("round-trips values through the mock state (FY6900 scalings)", async () => {
    const { fy } = await openFy6900();
    await fy.setFrequency(Channel.Main, 2500);
    await fy.setAmplitude(Channel.Main, 3.3);
    await fy.setOffset(Channel.Main, -1.5);
    await fy.setDutyCycle(Channel.Main, 25);
    await fy.setPhase(Channel.Main, 90);
    assert.equal(await fy.getFrequency(Channel.Main), 2500);
    assert.equal(await fy.getAmplitude(Channel.Main), 3.3);
    assert.equal(await fy.getOffset(Channel.Main), -1.5);
    assert.equal(await fy.getDutyCycle(Channel.Main), 25);
    assert.equal(await fy.getPhase(Channel.Main), 90);
    assert.equal(await fy.getOutput(Channel.Main), false);
  });

  it("round-trips values through the mock state (FY2300 scalings)", async () => {
    const { fy } = await openFy2300();
    await fy.setAmplitude(Channel.Main, 3.3);
    await fy.setOffset(Channel.Main, -1);
    assert.equal(await fy.getAmplitude(Channel.Main), 3.3);
    assert.equal(await fy.getOffset(Channel.Main), -1);
  });
});

describe("modulation mode codes", () => {
  it("writes the documented WPF code for every mode", async () => {
    const { fy, mock } = await openFy6900();
    const expected: Array<[ModulationMode, string]> = [
      [ModulationMode.ASK, "WPF0\n"],
      [ModulationMode.FSK, "WPF1\n"],
      [ModulationMode.PSK, "WPF2\n"],
      [ModulationMode.Burst, "WPF3\n"],
      [ModulationMode.AM, "WPF4\n"],
      [ModulationMode.FM, "WPF5\n"],
      [ModulationMode.PM, "WPF6\n"],
    ];
    for (const [mode, line] of expected) {
      await fy.setModulationMode(mode);
      assert.ok(mock.writes.includes(line), `expected ${JSON.stringify(line)}`);
    }
  });

  it("getModulationMode returns the decoded value", async () => {
    const { fy } = await openFy6900();
    await fy.setModulationMode(ModulationMode.AM);
    assert.equal(await fy.getModulationMode(), ModulationMode.AM);
  });
});

describe("sweep", () => {
  it("applies the +10 V offset bias on the FY6900 family", async () => {
    const { fy, mock } = await openFy6900();
    await fy.setSweepStart(1, SweepObject.Offset);
    await fy.setSweepEnd(5, SweepObject.Offset);
    assert.ok(mock.writes.includes("SST11.000\n"));
    assert.ok(mock.writes.includes("SEN15.000\n"));
  });

  it("does not bias offsets on FY2300", async () => {
    const { fy, mock } = await openFy2300();
    await fy.setSweepStart(1, SweepObject.Offset);
    assert.ok(mock.writes.includes("SST1.000\n"));
  });

  it("does not bias other sweep objects", async () => {
    const { fy, mock } = await openFy6900();
    await fy.setSweepStart(100, SweepObject.Frequency);
    await fy.setSweepStart(2, SweepObject.Amplitude);
    await fy.setSweepStart(30, SweepObject.DutyCycle);
    assert.ok(mock.writes.includes("SST100.0\n"));
    assert.ok(mock.writes.includes("SST2.000\n"));
    assert.ok(mock.writes.includes("SST30.0\n"));
  });

  it("configureSweep issues all commands and startSweep starts it", async () => {
    const { fy, mock } = await openFy6900();
    await fy.configureSweep({
      object: SweepObject.Frequency,
      start: 100,
      end: 10_000,
      timeSeconds: 5,
      mode: SweepMode.Linear,
    });
    await fy.startSweep();
    for (const line of ["SOB0\n", "SST100.0\n", "SEN10000.0\n", "STI5.00\n", "SMO0\n", "SBE1\n"]) {
      assert.ok(mock.writes.includes(line), `expected ${JSON.stringify(line)}`);
    }
  });
});

describe("frequency counter", () => {
  it("decodes RCD as /10 regardless of family", async () => {
    const { fy, mock } = await openFy6900();
    mock.state.set("RCD", "250");
    assert.equal(await fy.readMeasuredDutyPct(), 25);

    const { fy: fy2300, mock: mock2300 } = await openFy2300();
    mock2300.state.set("RCD", "250");
    assert.equal(await fy2300.readMeasuredDutyPct(), 25);
  });

  it("readMeasurement scales frequency by gate time and duty by /10", async () => {
    const { fy, mock } = await openFy6900();
    mock.state.set("RCG", String(GateTime.TenSeconds));
    mock.state.set("RCF", "10000");
    mock.state.set("RCD", "668");
    const m = await fy.readMeasurement();
    assert.equal(m.frequencyHz, 1000);
    assert.equal(m.dutyCyclePct, 66.8);
    assert.equal(m.gateTime, GateTime.TenSeconds);
  });
});

describe("validation", () => {
  it("rejects invalid channels", async () => {
    const { fy } = await openFy6900();
    await assert.rejects(fy.setFrequency(2 as Channel, 1000), FeelTechError);
    await assert.rejects(fy.getFrequency(-1 as Channel), FeelTechError);
  });

  it("rejects out-of-range parameters", async () => {
    const { fy } = await openFy6900();
    await assert.rejects(fy.setDutyCycle(Channel.Main, 150), FeelTechError);
    await assert.rejects(fy.setDutyCycle(Channel.Main, -1), FeelTechError);
    await assert.rejects(fy.setPhase(Channel.Main, 400), FeelTechError);
    await assert.rejects(fy.setFrequency(Channel.Main, -5), FeelTechError);
    await assert.rejects(fy.setFrequency(Channel.Main, NaN), FeelTechError);
    await assert.rejects(fy.setAmplitude(Channel.Main, -1), FeelTechError);
    await assert.rejects(fy.setBurstCount(0), FeelTechError);
    await assert.rejects(fy.setBurstCount(2_000_000), FeelTechError);
    await assert.rejects(fy.saveState(0), FeelTechError);
    await assert.rejects(fy.loadState(100), FeelTechError);
  });
});

describe("uploadWaveform", () => {
  it("rejects out-of-range slots per family", async () => {
    const values = new Array<number>(8192).fill(0);
    const { fy } = await openFy6900();
    await assert.rejects(fy.uploadWaveform(0, values), FeelTechError);
    await assert.rejects(fy.uploadWaveform(65, values), FeelTechError);
    await assert.rejects(fy.uploadWaveform(1.5, values), FeelTechError);

    const { fy: fy2300 } = await openFy2300();
    await assert.rejects(fy2300.uploadWaveform(17, values), FeelTechError);
  });

  it("rejects a wrong sample count unless resample is requested", async () => {
    const { fy } = await openFy6900();
    await assert.rejects(fy.uploadWaveform(1, [0, 1, 0]), FeelTechError);
  });

  it("refuses to overwrite the active arbitrary waveform", async () => {
    const { fy, mock } = await openFy6900();
    mock.state.set("RMW", "37"); // Arbitrary1 active on CH1
    await assert.rejects(
      fy.uploadWaveform(1, new Array<number>(8192).fill(0)),
      /active on channel CH1/,
    );
  });

  it("scales min/max exactly to 0 and 16383 and uploads the packed bytes", async () => {
    const { fy, mock } = await openFy6900();
    const values = [0, 0.5, 1, 0];
    await fy.uploadWaveform(1, values, { sampleCount: 4, minValue: 0, maxValue: 1 });
    assert.equal(mock.uploads.length, 1);
    assert.equal(mock.uploads[0]!.slot, 1);
    const data = mock.uploads[0]!.data;
    assert.equal(data.length, 8);
    // Sample 0 → raw 0
    assert.equal(data[0], 0x00);
    assert.equal(data[1], 0x00);
    // Sample 0.5 → raw 8192 (0x2000): low 0x00, high 0x20
    assert.equal(data[2], 0x00);
    assert.equal(data[3], 0x20);
    // Sample 1 → raw 16383 (0x3FFF): low 0xFF, high 0x3F
    assert.equal(data[4], 0xff);
    assert.equal(data[5], 0x3f);
  });
});

describe("command serialization", () => {
  it("serializes concurrent commands without interleaving", async () => {
    const { fy, mock } = await openFy6900();
    const before = mock.writes.length;
    await Promise.all([
      fy.setFrequency(Channel.Main, 1000),
      fy.setAmplitude(Channel.Main, 1),
      fy.setOutput(Channel.Main, true),
    ]);
    const writes = mock.writes.slice(before).filter((l) => l.startsWith("WM"));
    assert.deepEqual(writes, ["WMF00001000.000000\n", "WMA1.0000\n", "WMN1\n"]);
  });
});

describe("write verification", () => {
  it("retries when the firmware drops a write, then succeeds", async () => {
    let drops = 1;
    const mock = new MockTransport({
      family: "FY6900",
      // Ack the first WMF without applying it — exactly the observed quirk.
      responder: (cmd) => (cmd.startsWith("WMF") && drops-- > 0 ? [""] : undefined),
    });
    const fy = new FeelTech(mock);
    await fy.open();
    await fy.setFrequency(Channel.Main, 1000);
    assert.equal(mock.writes.filter((w) => w.startsWith("WMF")).length, 2);
    assert.equal(await fy.getFrequency(Channel.Main), 1000);
  });

  it("throws FeelTechVerifyError when the write is never applied", async () => {
    const mock = new MockTransport({
      family: "FY6900",
      responder: (cmd) => (cmd.startsWith("WMA") ? [""] : undefined),
    });
    const fy = new FeelTech(mock);
    await fy.open();
    await assert.rejects(fy.setAmplitude(Channel.Main, 3.3), FeelTechVerifyError);
    // 1 attempt + writeRetries (default 2)
    assert.equal(mock.writes.filter((w) => w.startsWith("WMA")).length, 3);
  });

  it("skips the readback when verifyWrites is false", async () => {
    const mock = new MockTransport({ family: "FY6900" });
    const fy = new FeelTech(mock, { verifyWrites: false });
    await fy.open();
    await fy.setFrequency(Channel.Main, 1000);
    assert.ok(mock.writes.includes("WMF00001000.000000\n"));
    assert.ok(!mock.writes.some((w) => w.startsWith("RMF")));
  });

  it("skips verification for frequency when the encoding is overridden", async () => {
    const mock = new MockTransport({ family: "FY6900" });
    const fy = new FeelTech(mock, { frequencyEncoding: "uHz" });
    await fy.open();
    await fy.setFrequency(Channel.Main, 1000);
    assert.ok(mock.writes.includes("WMF00001000000000\n"));
    assert.ok(!mock.writes.some((w) => w.startsWith("RMF")));
  });
});
