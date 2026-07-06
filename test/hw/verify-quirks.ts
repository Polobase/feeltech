/**
 * Hardware quirk verification & smoke test.
 *
 * Run manually against a real device (never in CI):
 *
 *   npm run test:hw -- /dev/cu.wchusbserial1220
 *
 * Probes two protocol ambiguities that the docs/PDFs disagree on:
 *
 *   1. Counter duty-cycle (RCD) scaling — /10 (docs §9) vs /1000 (channel-duty
 *      scale). Requires a BNC loop from CH1 output to the counter input;
 *      reports "no signal" otherwise.
 *
 *   2. Offset-sweep bias — fygen adds +10 V to SST/SEN values for offset
 *      sweeps on the FY6900 family. If the bias is required, sweeping
 *      "0 → 5 V" without it actually sweeps −10 → −5 V.
 *
 * The script restores a neutral state (sweep stopped, offset 0, output off)
 * before exiting.
 */

import { connectNode, Channel, SweepMode, SweepObject } from "../../src/index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const port = process.argv[2];
if (!port) {
  console.error("Usage: npm run test:hw -- <serial-port>");
  process.exit(1);
}

const fy = await connectNode(port);
console.log(`Connected: ${fy.deviceModel} (family: ${fy.family})\n`);

try {
  // ── Probe 1: counter RCD scaling ──────────────────────────────────────────
  console.log("── Probe 1: counter duty-cycle (RCD) scaling ──");
  console.log("Setting CH1: Square, 1 kHz, 3 Vpp, duty 25 %, output ON.");
  console.log("Loop CH1 output to the counter input (BNC) for a valid reading.\n");

  await fy.configureChannel(Channel.Main, {
    waveform: "Square",
    frequencyHz: 1000,
    amplitudeV: 3,
    offsetV: 0,
    dutyCyclePct: 25,
    enabled: true,
  });
  await fy.resetCounter();
  await sleep(3000);

  const rawFreq = await fy.sendRead("RCF");
  const rawDuty = await fy.sendRead("RCD");
  const freq = Number(rawFreq);
  const duty = Number(rawDuty);

  console.log(`RCF raw: ${JSON.stringify(rawFreq)}  (≈${freq} Hz at gate 1 s)`);
  console.log(`RCD raw: ${JSON.stringify(rawDuty)}`);
  if (freq < 100) {
    console.log("→ No/weak signal at counter input (RCF ≈ 0) — probe INCONCLUSIVE without BNC loop.\n");
  } else {
    console.log(`→ interpreted /10   = ${duty / 10} %   (expected ≈ 25)`);
    console.log(`→ interpreted /1000 = ${duty / 1000} % (expected ≈ 25)`);
    const verdict =
      Math.abs(duty / 10 - 25) < 3 ? "/10" : Math.abs(duty / 1000 - 25) < 3 ? "/1000" : "UNCLEAR";
    console.log(`→ RCD scaling verdict: ${verdict}\n`);
  }

  // ── Probe 2: offset-sweep bias ────────────────────────────────────────────
  console.log("── Probe 2: offset-sweep +10 V bias ──");
  console.log("Sweeping offset 0 → 5 V over 10 s (unbiased SST/SEN values), polling RMO.\n");

  await fy.configureChannel(Channel.Main, {
    waveform: "Sine",
    frequencyHz: 100,
    amplitudeV: 1,
    offsetV: 0,
    enabled: true,
  });
  await fy.configureSweep({
    object: SweepObject.Offset,
    start: 0,
    end: 5,
    timeSeconds: 10,
    mode: SweepMode.Linear,
  });
  await fy.startSweep();

  const readings: number[] = [];
  for (let i = 0; i < 5; i++) {
    await sleep(1000);
    const rawOffset = await fy.sendRead("RMO");
    const decoded = await fy.getOffset(Channel.Main);
    readings.push(decoded);
    console.log(`t=${i + 1}s  RMO raw: ${JSON.stringify(rawOffset)}  decoded: ${decoded} V`);
  }

  await fy.stopSweep();
  await fy.setOffset(Channel.Main, 0);

  const valid = readings.filter((v) => Number.isFinite(v));
  const avg = valid.reduce((a, b) => a + b, 0) / Math.max(valid.length, 1);
  if (valid.length === 0) {
    console.log("\n→ RMO not readable during sweep — probe INCONCLUSIVE (check device display instead).");
  } else if (avg < -4) {
    console.log(`\n→ avg ${avg.toFixed(2)} V ≈ −10…−5 range: +10 V bias IS required on this family.`);
  } else if (avg >= -1 && avg <= 6) {
    console.log(`\n→ avg ${avg.toFixed(2)} V within 0…5 range: +10 V bias NOT required on this device.`);
  } else {
    console.log(`\n→ avg ${avg.toFixed(2)} V — UNCLEAR, check the device display during the sweep.`);
  }
} finally {
  try {
    await fy.stopSweep();
    await fy.setOutput(Channel.Main, false);
  } catch {
    /* best effort cleanup */
  }
  await fy.close();
}
console.log("\nDone.");
