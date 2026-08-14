/**
 * Sweep amplitude from 1 V to 5 V over 2 seconds.
 *
 *   npm run example:sweep:amp -- [port]
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
    object: 1, // amplitude
    start: 1,
    end: 5,
    timeSeconds: 2,
    mode: 0,
    source: 0,
  });

  await fy.startSweep();
  console.log("Sweeping amplitude 1 V -> 5 V over 2 s...");
  await new Promise((r) => setTimeout(r, 3000));
  await fy.stopSweep();
  console.log("Sweep stopped.");
} finally {
  await fy.setOutput(Channel.Main, false);
  await fy.close();
}
