/**
 * Run a {@link PresetRun} on any {@link SignalGenerator}.
 *
 * The plan is device-agnostic (a list of output configs plus a frequency
 * timeline of steps and sweeps); this runner drives it through the core
 * {@link SignalGenerator} primitives, so the same plan runs unchanged on a
 * Spooky2 Gen X Pro, a FeelTech FY, or any other supported generator.
 *
 * It mirrors the structure a Spooky2 capture shows for running a preset:
 * configure amplitude/offset/waveform once, turn the outputs on, then loop the
 * frequency register per step (a sweep is a host-side frequency loop), and turn
 * the outputs off at the end.
 */

import type { SignalGenerator } from "@freqgen/core";
import type { PresetRun, PresetSegment } from "./presets.js";

export interface RunPresetOptions {
  /** Cancel the run (the current dwell ends early). */
  signal?: AbortSignal;
  /** Injectable delay, for tests. Default: real `setTimeout`. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Called as each segment begins. */
  onSegment?: (index: number, segment: PresetSegment) => void;
}

/** Real sleep that resolves early if the signal aborts. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    const onAbort = () => done();
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run a preset plan on a generator.
 *
 * Outputs are configured first (waveform, amplitude, offset) and switched on;
 * then each segment drives the frequency. The outputs are switched off when the
 * run finishes or is aborted.
 */
export async function runPresetRun(
  device: SignalGenerator,
  run: PresetRun,
  options: RunPresetOptions = {},
): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  const signal = options.signal;

  for (const output of run.outputs) {
    await device.setWaveform(output.channel, output.waveform);
    await device.setAmplitude(output.channel, output.amplitudeVpp);
    await device.setOffset(output.channel, output.offsetV);
    await device.setOutput(output.channel, true);
  }

  const setFrequency = (hz: number) =>
    Promise.all(run.outputs.map((o) => device.setFrequency(o.channel, hz)));

  try {
    for (let i = 0; i < run.segments.length; i++) {
      if (signal?.aborted) return;
      const segment = run.segments[i]!;
      options.onSegment?.(i, segment);
      if (segment.type === "step") {
        await setFrequency(segment.frequencyHz);
        await sleep(segment.dwellSeconds * 1000, signal);
      } else {
        const stepHz = (segment.endHz - segment.startHz) / segment.steps;
        for (let s = 0; s <= segment.steps; s++) {
          if (signal?.aborted) return;
          await setFrequency(segment.startHz + stepHz * s);
          await sleep(segment.dwellPerStepSeconds * 1000, signal);
        }
      }
    }
  } finally {
    await Promise.all(run.outputs.map((o) => device.setOutput(o.channel, false)));
  }
}
