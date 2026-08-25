/**
 * Sweep duty cycle from 10 % to 90 % over 2 seconds.
 *
 *   npm run example:sweep:duty -- [port]
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2];
const fy = await connectNode(path, { debug: true });

try {
  await fy.configureChannel(Channel.Main, {
    waveform: "Square",
    frequencyHz: 1000,
    amplitudeV: 3,
    enabled: true,
  });

  await fy.configureSweep({
    object: 3, // duty
    start: 10,
    end: 90,
    timeSeconds: 2,
    mode: 0,
    source: 0,
  });

  await fy.startSweep();
  console.log("Sweeping duty 10 % -> 90 % over 2 s...");
  await new Promise((r) => setTimeout(r, 3000));
  await fy.stopSweep();
  console.log("Sweep stopped.");
} finally {
  await fy.setOutput(Channel.Main, false);
  await fy.close();
}
