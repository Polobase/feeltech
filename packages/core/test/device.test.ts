import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyStepSequentially,
  substituteWaveform,
  type ChannelStep,
  type WaveformKind,
} from "../src/device.js";

describe("substituteWaveform", () => {
  it("returns the request unchanged when supported", () => {
    assert.equal(substituteWaveform("square", ["sine", "square"]), "square");
  });

  it("degrades a ramp to a triangle before a square", () => {
    // A triangle keeps the linear slopes; a square does not.
    assert.equal(substituteWaveform("ramp-up", ["sine", "square", "triangle"]), "triangle");
  });

  it("degrades a sawtooth to sine on a sine/square-only device", () => {
    // This is the Gen X case: only sine and square slots exist.
    assert.equal(substituteWaveform("ramp-up", ["sine", "square"]), "sine");
  });

  it("prefers the opposite ramp over a triangle", () => {
    assert.equal(
      substituteWaveform("ramp-down", ["sine", "triangle", "ramp-up"]),
      "ramp-up",
    );
  });

  it("returns undefined when nothing sensible is available", () => {
    assert.equal(substituteWaveform("sine", []), undefined);
    assert.equal(substituteWaveform("noise", ["square"]), undefined);
  });
});

describe("applyStepSequentially", () => {
  function recorder() {
    const calls: string[] = [];
    const dev = {
      setWaveform: async (_c: number, w: WaveformKind | number) => {
        calls.push(`waveform=${String(w)}`);
        return { requested: "sine" as const, actual: "sine" as const, substituted: false, code: 0 };
      },
      setFrequency: async (_c: number, hz: number) => void calls.push(`freq=${hz}`),
      setAmplitude: async (_c: number, v: number) => void calls.push(`amp=${v}`),
      setOffset: async (_c: number, v: number) => void calls.push(`offset=${v}`),
      setDutyCycle: async (_c: number, p: number) => void calls.push(`duty=${p}`),
      setPhase: async (_c: number, d: number) => void calls.push(`phase=${d}`),
      setOutput: async (_c: number, on: boolean) => void calls.push(`output=${on}`),
    };
    return { calls, dev };
  }

  it("sets the waveform first and the output last", () => {
    // Duty is waveform-dependent on some firmwares, so waveform must precede it;
    // output goes last so a channel never switches on with stale parameters.
    const { calls, dev } = recorder();
    const step: ChannelStep = {
      output: true,
      dutyCyclePct: 25,
      frequencyHz: 1000,
      waveform: "square",
    };
    return applyStepSequentially(dev, 0, step).then(() => {
      assert.deepEqual(calls, ["waveform=square", "freq=1000", "duty=25", "output=true"]);
    });
  });

  it("skips omitted fields entirely", async () => {
    const { calls, dev } = recorder();
    await applyStepSequentially(dev, 0, { frequencyHz: 440 });
    assert.deepEqual(calls, ["freq=440"]);
  });

  it("applies output:false as an explicit instruction", async () => {
    const { calls, dev } = recorder();
    await applyStepSequentially(dev, 0, { output: false });
    assert.deepEqual(calls, ["output=false"]);
  });
});
