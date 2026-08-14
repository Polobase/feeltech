import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runProgram, type ProgramStep } from "../src/program.js";
import type { AppliedWaveform, ChannelStep, SignalGenerator } from "../src/device.js";
import { DEFAULT_CAPABILITIES } from "../src/capabilities.js";
import { unknownLimits } from "../src/limits.js";

/** A generator that records applyStep/setOutput calls; no real timing. */
function fake() {
  const applied: Array<{ channel: number; step: ChannelStep }> = [];
  const outputs: Array<{ channel: number; on: boolean }> = [];
  const device: SignalGenerator = {
    info: { vendor: "test", model: "fake" },
    capabilities: { ...DEFAULT_CAPABILITIES, waveforms: [], limits: unknownLimits() },
    async open() {},
    async close() {},
    async setWaveform(): Promise<AppliedWaveform> {
      return { requested: "sine", actual: "sine", substituted: false, code: 0 };
    },
    async setFrequency() {},
    async setAmplitude() {},
    async setOffset() {},
    async setDutyCycle() {},
    async setPhase() {},
    async setOutput(channel, on) {
      outputs.push({ channel, on });
    },
    async applyStep(channel, step) {
      applied.push({ channel, step });
    },
  };
  return { device, applied, outputs };
}

/** Sleep that records requested durations instead of waiting. */
function recordingSleep() {
  const durations: number[] = [];
  const sleep = async (ms: number) => void durations.push(ms);
  return { sleep, durations };
}

const steps: ProgramStep[] = [
  { frequencyHz: 1000, dwellSeconds: 3 },
  { frequencyHz: 2000, dwellSeconds: 5 },
];

describe("runProgram", () => {
  it("applies each step and dwells for its duration", async () => {
    const { device, applied } = fake();
    const { sleep, durations } = recordingSleep();
    const result = await runProgram(device, steps, { sleep });

    assert.equal(applied.length, 2);
    assert.equal(applied[0]!.step.frequencyHz, 1000);
    assert.equal(applied[1]!.step.frequencyHz, 2000);
    assert.deepEqual(durations, [3000, 5000]);
    assert.deepEqual(result, { stepsRun: 2, passesCompleted: 1, aborted: false });
  });

  it("forces output on for steps that do not specify it", async () => {
    const { device, applied } = fake();
    const { sleep } = recordingSleep();
    await runProgram(device, steps, { sleep });
    assert.equal(applied[0]!.step.output, true);
    assert.equal(applied[1]!.step.output, true);
  });

  it("preserves an explicit silent gap", async () => {
    const { device, applied } = fake();
    const { sleep } = recordingSleep();
    await runProgram(device, [{ dwellSeconds: 1, output: false }], { sleep });
    assert.equal(applied[0]!.step.output, false);
  });

  it("repeats the whole list", async () => {
    const { device, applied } = fake();
    const { sleep, durations } = recordingSleep();
    const result = await runProgram(device, steps, { sleep, repeat: 3 });
    assert.equal(applied.length, 6);
    assert.equal(durations.length, 6);
    assert.equal(result.passesCompleted, 3);
  });

  it("turns the output off at the end by default", async () => {
    const { device, outputs } = fake();
    const { sleep } = recordingSleep();
    await runProgram(device, steps, { sleep, channel: 1 });
    assert.deepEqual(outputs.at(-1), { channel: 1, on: false });
  });

  it("leaves output alone when asked", async () => {
    const { device, outputs } = fake();
    const { sleep } = recordingSleep();
    await runProgram(device, steps, { sleep, stopOutputAtEnd: false });
    assert.equal(outputs.length, 0);
  });

  it("stops early when aborted and still turns output off", async () => {
    const { device, applied, outputs } = fake();
    const controller = new AbortController();
    // Abort during the first dwell.
    const sleep = async () => controller.abort();
    const result = await runProgram(device, steps, {
      sleep,
      signal: controller.signal,
    });
    assert.equal(applied.length, 1); // second step never applied
    assert.equal(result.aborted, true);
    assert.equal(result.passesCompleted, 0);
    assert.deepEqual(outputs.at(-1), { channel: 0, on: false });
  });

  it("does not start if the signal is already aborted", async () => {
    const { device, applied } = fake();
    const controller = new AbortController();
    controller.abort();
    const { sleep } = recordingSleep();
    const result = await runProgram(device, steps, { sleep, signal: controller.signal });
    assert.equal(applied.length, 0);
    assert.equal(result.aborted, true);
  });

  it("reports progress per step", async () => {
    const { device } = fake();
    const { sleep } = recordingSleep();
    const seen: Array<[number, number]> = [];
    await runProgram(device, steps, {
      sleep,
      repeat: 2,
      onStep: (p) => seen.push([p.pass, p.stepIndex]),
    });
    assert.deepEqual(seen, [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
  });
});
