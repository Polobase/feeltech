import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RecordingTransport } from "@freqgen/core/testing";
import { GenXPro } from "../src/genx-pro.js";
import { GenXPair } from "../src/genx-pair.js";
import { generateNonce } from "../src/auth.js";

async function pro(options = {}) {
  const transport = new RecordingTransport({ defaultResponse: ":ok" });
  const device = new GenXPro(transport, { replyTimeoutMs: 20, ...options });
  await device.open();
  transport.clear();
  return { transport, device };
}

const stripCRLF = (writes: string[]) => writes.map((w) => w.trimEnd());

describe("GenXPro link setup", () => {
  it("opens the port at the documented framing", async () => {
    const transport = new RecordingTransport({ defaultResponse: ":ok" });
    await new GenXPro(transport, { replyTimeoutMs: 20 }).open();
    assert.deepEqual(transport.openOptions, {
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
  });

  it("connects without an authProvider but reports output as gated", async () => {
    const { device } = await pro();
    assert.equal(device.authenticated, false);
    assert.equal(device.capabilities.requiresAuth, true);
    // The arm/ramp requirement was an artefact of a mis-read register map.
    assert.equal(device.capabilities.requiresFrequencyRamp, false);
  });
});

describe("GenXPro register map (vendor-confirmed)", () => {
  it("writes frequency to register 24/25, one field per output", async () => {
    const { transport, device } = await pro();
    await device.setFrequency(0, 1000); // ≥600 Hz → high scale (×100)
    await device.setFrequency(1, 1000);
    assert.deepEqual(stripCRLF(transport.writes), [":w24=100000,,", ":w25=,100000,"]);
  });

  it("writes amplitude to register 28/29 — the register the hardware confirmed", async () => {
    const { transport, device } = await pro();
    await device.setAmplitude(0, 5);
    await device.setAmplitude(1, 3.3);
    assert.deepEqual(stripCRLF(transport.writes), [":w28=500,,", ":w29=,330,"]);
  });

  it("writes waveform to register 20/21", async () => {
    const { transport, device } = await pro();
    assert.equal((await device.setWaveform(0, "sine")).code, 11);
    assert.equal((await device.setWaveform(1, "square")).code, 12);
    assert.deepEqual(stripCRLF(transport.writes), [":w20=11,,", ":w21=,12,"]);
  });

  it("writes offset to register 32/33, centred on 120", async () => {
    const { transport, device } = await pro();
    await device.setOffsetRatio(0, 0);
    await device.setOffsetRatio(0, 1);
    await device.setOffsetRatio(1, -1);
    assert.deepEqual(stripCRLF(transport.writes), [":w32=120,,", ":w32=170,,", ":w33=,70,"]);
  });

  it("switches low-frequency mode across the boundary", async () => {
    const { transport, device } = await pro();
    await device.setFrequency(0, 100); // <600 Hz → low mode, ×100000
    assert.deepEqual(stripCRLF(transport.writes), [":w15=1,,", ":w24=10000000,,"]);
  });

  it("addresses both outputs together on the shared output register", async () => {
    const { transport, device } = await pro();
    await device.setOutput(0, true);
    await device.setOutput(1, true);
    await device.setOutput(0, false);
    assert.deepEqual(stripCRLF(transport.writes), [
      ":w11=1,0,",
      ":w11=1,1,",
      ":w11=0,1,",
    ]);
  });
});

describe("GenXPro phase", () => {
  it("sets Out 2 phase on register 40", async () => {
    const { transport, device } = await pro();
    await device.setPhase(1, 90);
    assert.deepEqual(stripCRLF(transport.writes), [":w40=,90,"]);
  });

  it("refuses an Out 1 phase, which the device has no register for", async () => {
    const { device } = await pro();
    await device.setPhase(0, 0); // 0 is a no-op
    await assert.rejects(device.setPhase(0, 45), /no Out 1 phase register/);
  });
});

describe("GenXPro per-output extras", () => {
  it("drives gating, modulation, sync, inversion and low-frequency mode", async () => {
    const { transport, device } = await pro();
    await device.setGating(0, true);        // Out1 gating → w12
    await device.setGating(1, true);        // Out2 gating → w70
    await device.setModulation(true);       // Out2 modulation → w13
    await device.setSync(true);             // Out2 sync → w14
    await device.setInversion(0, true);     // inversion Out1 → w17
    await device.setLowFrequencyMode(1, true); // Out2 LF mode → w51
    assert.deepEqual(stripCRLF(transport.writes), [
      ":w12=1,,",
      ":w70=,1,",
      ":w13=,1,",
      ":w14=,1,",
      ":w17=1,,",
      ":w51=,1,",
    ]);
  });

  it("runs calibration and reset", async () => {
    const { transport, device } = await pro();
    await device.calibrate("none");
    await device.calibrate("50ohm");
    await device.reset();
    assert.deepEqual(stripCRLF(transport.writes), [":w50=1,,", ":w71=1,,", ":w95=12021,"]);
  });
});

describe("GenXPro unsupported parameters", () => {
  it("accepts a 50 % duty (the neutral every preset carries) and refuses others", async () => {
    const { device } = await pro();
    await device.setDutyCycle(0, 50);
    await assert.rejects(device.setDutyCycle(0, 25), /No duty-cycle register/);
  });
});

describe("GenXPro applyStep", () => {
  it("drives the channel as plain register writes, output last", async () => {
    const { transport, device } = await pro();
    await device.applyStep(0, {
      waveform: "square",
      frequencyHz: 1000,
      amplitudeVpp: 5,
      output: true,
    });
    assert.deepEqual(stripCRLF(transport.writes), [
      ":w20=12,,",
      ":w24=100000,,",
      ":w28=500,,",
      ":w11=1,0,",
    ]);
  });
});

describe("GenXPro waveforms", () => {
  it("reports a sawtooth request as substituted, not silently swapped", async () => {
    const { device } = await pro();
    const applied = await device.setWaveform(0, "ramp-up");
    assert.equal(applied.requested, "ramp-up");
    assert.equal(applied.actual, "sine");
    assert.equal(applied.substituted, true);
  });
});

describe("GenXPro authentication", () => {
  it("explains itself when asked to authenticate with no provider", async () => {
    const { device } = await pro();
    await assert.rejects(device.authenticate(), /ships no response algorithm/);
  });

  it("runs two challenge rounds and passes the device's values to the provider", async () => {
    const seen: Array<{ nonce: string; v1: string; v2: string }> = [];
    const transport = new RecordingTransport({
      responder: (cmd) => (cmd.startsWith(":r90=") ? "123456789,987654321" : ":ok"),
    });
    const device = new GenXPro(transport, {
      replyTimeoutMs: 20,
      authProvider: {
        respond(challenge) {
          seen.push(challenge);
          return "111111111";
        },
      },
    });
    await device.open();

    assert.equal(device.authenticated, true);
    assert.equal(seen.length, 2);
    assert.equal(seen[0]!.v1, "123456789");
    assert.equal(seen[0]!.v2, "987654321");
    assert.match(seen[0]!.nonce, /^[1-9]{9}$/);
    assert.ok(transport.writes.some((w) => w === ":w92=111111111.\r\n"));
  });

  it("keeps registers usable when authentication fails", async () => {
    const transport = new RecordingTransport({
      responder: (cmd) => (cmd.startsWith(":r90=") ? "garbage" : ":ok"),
    });
    const device = new GenXPro(transport, {
      replyTimeoutMs: 20,
      authProvider: { respond: () => "0" },
    });
    await device.open();
    assert.equal(device.authenticated, false);
    await device.setAmplitude(0, 5);
    assert.ok(transport.writes.some((w) => w === ":w28=500,,\r\n"));
  });
});

describe("generateNonce", () => {
  it("is a permutation of 1–9, never containing a zero", () => {
    for (let i = 0; i < 50; i++) {
      const nonce = generateNonce();
      assert.equal(nonce.length, 9);
      assert.deepEqual([...nonce].sort().join(""), "123456789");
    }
  });

  it("is deterministic for a given random source", () => {
    assert.equal(generateNonce(() => 0), generateNonce(() => 0));
    assert.equal(generateNonce(() => 0), "234567891");
  });
});

describe("GenXPair channel mapping", () => {
  function pair(identities: [string | null, string | null]) {
    const a = new GenXPro(new RecordingTransport({ defaultResponse: ":ok" }));
    const b = new GenXPro(new RecordingTransport({ defaultResponse: ":ok" }));
    return { a, b, pair: new GenXPair([a, b], identities) };
  }

  it("uses self-reported identity when the units disagree", () => {
    // Confirmed on hardware: the two ports report G1/G2 and it does not follow
    // connection order.
    const { a, b, pair: p } = pair(["G2", "G1"]);
    assert.equal(p.unitForChannel(0), b);
    assert.equal(p.unitForChannel(1), a);
  });

  it("falls back to connection order when both report the same identity", () => {
    const { a, b, pair: p } = pair(["G2", "G2"]);
    assert.equal(p.unitForChannel(0), a);
    assert.equal(p.unitForChannel(1), b);
  });

  it("reports authenticated only when every unit is", () => {
    const { pair: p } = pair([null, null]);
    assert.equal(p.authenticated, false);
  });
});
