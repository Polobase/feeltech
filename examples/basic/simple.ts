/**
 * Minimalist example: configure CH1 as a 1 kHz square wave at 3.3 Vpp.
 *
 *   pnpm example:simple -- /dev/cu.wchusbserial1220
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";
const fy = await connectNode(path, { debug: true });

await fy.configureChannel(Channel.Main, {
  waveform: "Square",
  frequencyHz: 1000,
  amplitudeV: 3.3,
  enabled: true,
});

console.log("CH1: 1 kHz square, 3.3 Vpp, output ON");
await fy.close();
