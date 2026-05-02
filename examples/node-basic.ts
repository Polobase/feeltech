/**
 * Basic example: configure CH1 to a 1 kHz sine wave at 3.3 Vpp, enable output,
 * wait 2 seconds, then disable output.
 *
 *   pnpm example:basic -- /dev/cu.wchusbserial1220
 */
import { connectNode, Channel } from "../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";
const fy = await connectNode(path, { debug: false });

try {
  await fy.configureChannel(Channel.Main, {
    waveform: "Sine",
    frequencyHz: 1000,
    amplitudeV: 3.3,
    offsetV: 0,
    dutyCyclePct: 50,
    phaseDeg: 0,
    enabled: true,
  });
  console.log("CH1: 1 kHz sine, 3.3 Vpp, output ON for 2 s …");
  await new Promise((r) => setTimeout(r, 2000));
  await fy.setOutput(Channel.Main, false);
  console.log("Output disabled.");
} finally {
  await fy.close();
}
