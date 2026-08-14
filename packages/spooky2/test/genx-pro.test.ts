import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RecordingTransport } from "@freqgen/core/testing";
import { GenXPro, GENX_RAMP_MAX_STEPS } from "../src/genx-pro.js";
import { GenXPair } from "../src/genx-pair.js";
import { generateNonce } from "../src/auth.js";

async function pro(options = {}) {
  const transport = new RecordingTransport({ defaultResponse: ":ok" });
  const device = new GenXPro(transport, { replyTimeoutMs: 20, ...options });
  await device.open();
  transport.clear();
  return { transport, device };
}

/** Frequencies written during a ramp, in order. */
function rampPoints(writes: string[]): number[] {
  return writes
    .filter((w) => w.startsWith(":w28="))
    .map((w) => Number(/:w28=(\d+),/.exec(w)![1]));
}

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
  });
});

describe("GenXPro step sequence", () => {
  it("prepares, arms, ramps and only then sets amplitude", async () => {
    const { transport, device } = await pro();
    await device.runStep(0, 100, 5);
    const writes = transport.writes.map((w) => w.trimEnd());

    const armIndex = writes.indexOf(":w24=1008,"); // 100 Hz → mantissa 100, exp code 8
    const firstRamp = writes.findIndex((w) => w.startsWith(":w28=") && w !== ":w28=0,");
    const amplitude = writes.indexOf(":w17=500,500,");

    assert.ok(armIndex > 0, `expected an arm write, got ${JSON.stringify(writes)}`);
    assert.ok(firstRamp > armIndex, "ramp must follow the arm sequence");
    assert.ok(amplitude > firstRamp, "amplitude must come after the ramp");
  });

  it("sets the display text before touching registers", async () => {
    const { transport, device } = await pro();
    await device.runStep(0, 440, 5);
    assert.ok(transport.writes[0]!.startsWith(":n00="));
  });

  it("prepares a channel once, not on every step", async () => {
    const { transport, device } = await pro();
    await device.runStep(0, 440, 5);
    const first = transport.writes.filter((w) => w === ":w14=1,\r\n").length;
    transport.clear();
    await device.runStep(0, 880, 5);
    const second = transport.writes.filter((w) => w === ":w14=1,\r\n").length;
    assert.equal(first, 1);
    assert.equal(second, 0);
  });

  it("re-prepares when the channel changes", async () => {
    const { transport, device } = await pro();
    await device.runStep(0, 440, 5);
    transport.clear();
    await device.runStep(1, 440, 5);
    assert.ok(transport.writes.some((w) => w === ":w14=2,\r\n"));
  });
});

describe("GenXPro frequency ramp", () => {
  it("walks up in 50 Hz steps when that is short enough", async () => {
    const { transport, device } = await pro();
    await device.runStep(0, 300, 5);
    // Intermediate points 50…250, then the target.
    assert.deepEqual(rampPoints(transport.writes).filter((v) => v !== 0), [
      50, 100, 150, 200, 250, 300,
    ]);
  });

  it("switches to even division rather than emitting hundreds of steps", async () => {
    const { transport, device } = await pro();
    await device.runStep(0, 30_000, 5);
    const points = rampPoints(transport.writes).filter((v) => v !== 0);
    // A 50 Hz walk to 30 kHz would be 599 steps; the cap keeps it bounded.
    assert.equal(points.length, GENX_RAMP_MAX_STEPS + 1);
    assert.equal(points.at(-1), 30_000);
  });

  it("always finishes exactly on the target", async () => {
    for (const target of [64, 727.5, 20_000, 146_000]) {
      const { transport, device } = await pro();
      await device.runStep(0, target, 5);
      const points = rampPoints(transport.writes).filter((v) => v !== 0);
      assert.equal(
        points.at(-1),
        target === 727.5 ? 72750 : target,
        `ramp to ${target} Hz ended on ${points.at(-1)}`,
      );
    }
  });

  it("ramps monotonically upward", async () => {
    const { transport, device } = await pro();
    await device.runStep(0, 5000, 5);
    const points = rampPoints(transport.writes).filter((v) => v !== 0);
    for (let i = 1; i < points.length; i++) {
      assert.ok(points[i]! > points[i - 1]!, `not increasing at index ${i}`);
    }
  });
});

describe("GenXPro unsupported parameters", () => {
  it("accepts the neutral values a preset always carries", async () => {
    const { device } = await pro();
    // Spooky2 presets specify duty 50 and offset 0 on every shell; refusing
    // those would make every preset fail for no reason.
    await device.applyStep(0, {
      frequencyHz: 440,
      dutyCyclePct: 50,
      offsetV: 0,
      phaseDeg: 0,
    });
  });

  it("refuses a duty cycle it cannot actually deliver", async () => {
    const { device } = await pro();
    await assert.rejects(
      device.applyStep(0, { frequencyHz: 440, dutyCyclePct: 25 }),
      /Duty cycle is not adjustable/,
    );
  });

  it("refuses a DC offset rather than silently killing the output", async () => {
    const { device } = await pro();
    await assert.rejects(device.setOffset(0, 2), /not supported on the Gen X Pro/);
  });
});

describe("GenXPro output control", () => {
  it("disarms register 11 first when stopping", async () => {
    const { transport, device } = await pro();
    await device.stopOutput();
    // Without this ordering the output sticks at the armed frequency.
    assert.equal(transport.writes[0], ":w11=0,0,\r\n");
  });

  it("refuses to enable output with nothing armed", async () => {
    const { device } = await pro();
    await assert.rejects(device.setOutput(0, true), /set a frequency/);
  });

  it("treats output:false as a stop", async () => {
    const { transport, device } = await pro();
    await device.applyStep(0, { output: false });
    assert.equal(transport.writes[0], ":w11=0,0,\r\n");
  });
});

describe("GenXPro waveforms", () => {
  it("uses slot 11 for sine and 12 for square", async () => {
    const { transport, device } = await pro();
    assert.equal((await device.setWaveform(0, "sine")).code, 11);
    assert.equal((await device.setWaveform(1, "square")).code, 12);
    assert.deepEqual(transport.writes, [":w22=11,,\r\n", ":w22=,12,\r\n"]);
  });

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
    // Two rounds: a single successful exchange has been observed not to unlock.
    assert.equal(seen.length, 2);
    assert.equal(seen[0]!.v1, "123456789");
    assert.equal(seen[0]!.v2, "987654321");
    assert.match(seen[0]!.nonce, /^[1-9]{9}$/);
    assert.ok(transport.writes.some((w) => w === ":w92=111111111.\r\n"));
  });

  it("keeps the link up when authentication fails", async () => {
    const transport = new RecordingTransport({
      responder: (cmd) => (cmd.startsWith(":r90=") ? "garbage" : ":ok"),
    });
    const device = new GenXPro(transport, {
      replyTimeoutMs: 20,
      authProvider: { respond: () => "0" },
    });
    await device.open();
    assert.equal(device.authenticated, false);
    // Registers must still be usable — only physical output is gated.
    await device.setAmplitude(0, 5);
    assert.ok(transport.writes.some((w) => w === ":w17=500,500,\r\n"));
  });
});

describe("generateNonce", () => {
  it("is a permutation of 1–9, never containing a zero", () => {
    // The known response transforms index into the nonce digit by digit, and a
    // zero digit would collapse those lookups.
    for (let i = 0; i < 50; i++) {
      const nonce = generateNonce();
      assert.equal(nonce.length, 9);
      assert.deepEqual([...nonce].sort().join(""), "123456789");
    }
  });

  it("is deterministic for a given random source", () => {
    // Injectable randomness so a test can pin an auth transcript.
    assert.equal(generateNonce(() => 0), generateNonce(() => 0));
    assert.equal(generateNonce(() => 0), "234567891");
  });

  it("actually shuffles rather than returning the identity order", () => {
    const shuffled = new Set(Array.from({ length: 50 }, () => generateNonce()));
    assert.ok(shuffled.size > 1, "nonce should vary between calls");
  });
});

describe("GenXPair channel mapping", () => {
  function pair(identities: [string | null, string | null]) {
    const a = new GenXPro(new RecordingTransport({ defaultResponse: ":ok" }));
    const b = new GenXPro(new RecordingTransport({ defaultResponse: ":ok" }));
    return { a, b, pair: new GenXPair([a, b], identities) };
  }

  it("uses self-reported identity when the units disagree", () => {
    const { a, b, pair: p } = pair(["G2", "G1"]);
    assert.equal(p.unitForChannel(0), b);
    assert.equal(p.unitForChannel(1), a);
  });

  it("falls back to connection order when both report the same identity", () => {
    // Observed in the field: both ports report G2. Trusting that would send
    // both logical channels to one unit and leave the other silent.
    const { a, b, pair: p } = pair(["G2", "G2"]);
    assert.equal(p.unitForChannel(0), a);
    assert.equal(p.unitForChannel(1), b);
  });

  it("falls back to connection order when identity is unknown", () => {
    const { a, b, pair: p } = pair([null, null]);
    assert.equal(p.unitForChannel(0), a);
    assert.equal(p.unitForChannel(1), b);
  });

  it("reports authenticated only when every unit is", async () => {
    const { pair: p } = pair([null, null]);
    assert.equal(p.authenticated, false);
  });
});
