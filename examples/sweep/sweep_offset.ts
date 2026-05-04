/**
 * Sweep offset from -1 V to +1 V over 1.5 seconds.
 *
 *   pnpm example:sweep:offset -- /dev/cu.wchusbserial1220
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";
const fy = await connectNode(path, { debug: true });

try {
  await fy.configureChannel(Channel.Main, {
    waveform: "Square",
    frequencyHz: 1000,
    amplitudeV: 4,
    enabled: true,
  });

  await fy.configureSweep({
    object: 2, // offset
    start: -1,
    end: 1,
    timeSeconds: 1.5,
    mode: 0,
    source: 0,
  });

  await fy.startSweep();
  console.log("Sweeping offset -1 V -> +1 V over 1.5 s...");
  console.log("(Verify output voltages with a scope!)");
  await new Promise((r) => setTimeout(r, 2500));
  await fy.stopSweep();
  console.log("Sweep stopped.");
} finally {
  await fy.setOutput(Channel.Main, false);
  await fy.close();
}
