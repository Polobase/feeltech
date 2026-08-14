/**
 * Running a frequency program — a list of steps, each held for a dwell time.
 *
 * This is what "running a Rife program" or a Spooky2 preset chain actually is at
 * the device level: drive the generator to a step, wait, move on. Spooky2's
 * `SetChain` / `SetStep` / `SetDwell` are host-side scheduling of exactly this
 * kind, not device commands, so it lives here as orchestration over any
 * {@link SignalGenerator} rather than in a vendor package.
 *
 * The runner is deliberately I/O-injectable: it takes its own `sleep` and
 * `now`, so a test can drive a whole program to completion instantly and a
 * caller can cancel it through an `AbortSignal`.
 */

import type { ChannelStep, SignalGenerator } from "./device.js";

/** One step of a program: a channel state plus how long to hold it. */
export interface ProgramStep extends ChannelStep {
  /** How long to hold this step, in seconds. */
  dwellSeconds: number;
}

export interface ProgramOptions {
  /** Channel to drive. Default: 0. */
  channel?: number;
  /** How many times to run the whole list. Default: 1. `Infinity` loops until aborted. */
  repeat?: number;
  /** Turn the output off when the program finishes or is aborted. Default: true. */
  stopOutputAtEnd?: boolean;
  /** Cancel the run. On abort the current dwell ends early and the program stops. */
  signal?: AbortSignal;
  /** Called as each step begins. */
  onStep?: (info: ProgramProgress) => void;
  /** Injectable delay, for tests. Default: real `setTimeout`. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface ProgramProgress {
  /** Zero-based index of the step within the current pass. */
  stepIndex: number;
  /** Total steps per pass. */
  stepCount: number;
  /** Zero-based pass number. */
  pass: number;
  /** The step being applied. */
  step: ProgramStep;
}

export interface ProgramResult {
  /** Steps actually applied (across all passes). */
  stepsRun: number;
  /** Passes completed in full. */
  passesCompleted: number;
  /** True if the run stopped because its signal was aborted. */
  aborted: boolean;
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
 * Run a frequency program on a generator.
 *
 * Each step is applied with {@link SignalGenerator.applyStep} and then held for
 * its dwell. Steps that omit `output` have it forced on, so a bare list of
 * frequencies just runs; pass `output: false` on a step to insert a silent gap.
 *
 * Aborting ends the current dwell immediately and stops; the output is turned
 * off unless `stopOutputAtEnd` is false.
 */
export async function runProgram(
  device: SignalGenerator,
  steps: readonly ProgramStep[],
  options: ProgramOptions = {},
): Promise<ProgramResult> {
  const channel = options.channel ?? 0;
  const repeat = options.repeat ?? 1;
  const stopAtEnd = options.stopOutputAtEnd ?? true;
  const sleep = options.sleep ?? defaultSleep;
  const signal = options.signal;

  let stepsRun = 0;
  let passesCompleted = 0;
  let aborted = false;

  try {
    for (let pass = 0; pass < repeat; pass++) {
      for (let i = 0; i < steps.length; i++) {
        if (signal?.aborted) {
          aborted = true;
          return { stepsRun, passesCompleted, aborted };
        }
        const step = steps[i]!;
        options.onStep?.({ stepIndex: i, stepCount: steps.length, pass, step });
        await device.applyStep(channel, {
          ...step,
          output: step.output ?? true,
        });
        stepsRun += 1;
        await sleep(Math.max(0, step.dwellSeconds) * 1000, signal);
      }
      passesCompleted += 1;
    }
  } finally {
    if (signal?.aborted) aborted = true;
    if (stopAtEnd) {
      try {
        await device.setOutput(channel, false);
      } catch {
        /* best effort */
      }
    }
  }

  return { stepsRun, passesCompleted, aborted };
}
