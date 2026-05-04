/**
 * Sweep frequency from 1 kHz to 10 kHz over 10 seconds.
 *
 *   pnpm example:sweep:freq -- /dev/cu.wchusbserial110
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial110";
const fy = await connectNode(path, { debug: true });

try {
  await fy.configureChannel(Channel.Main, {
    waveform: "Sine",
    frequencyHz: 1000,
    amplitudeV: 3,
    enabled: true,
  });

  await fy.configureSweep({
    object: 0, // frequency
    start: 1000,
    end: 10000,
    timeSeconds: 10,
    mode: 0, // linear
    source: 0, // internal
  });

  await fy.startSweep();
  console.log("Sweeping frequency 1 kHz -> 10 kHz over 10 s...");
  console.log("(Press the adjustment knob on the generator to start if needed)");

  await new Promise((r) => setTimeout(r, 12000));
  await fy.stopSweep();
  console.log("Sweep stopped.");
} finally {
  await fy.setOutput(Channel.Main, false);
  await fy.close();
}
