/**
 * Wire-level debug probe — shows every byte exchanged with the device.
 *
 *   pnpm example:debug -- /dev/cu.wchusbserial1220
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";
const fy = await connectNode(path, { debug: true, readTimeoutMs: 2000, readRetries: 2 });

try {
  console.log("\n--- Probing CH1 ---\n");
  console.log("waveform:", await fy.getWaveform(Channel.Main));
  console.log("frequency:", await fy.getFrequency(Channel.Main));
  console.log("amplitude:", await fy.getAmplitude(Channel.Main));
  console.log("offset:", await fy.getOffset(Channel.Main));
  console.log("duty:", await fy.getDutyCycle(Channel.Main));
  console.log("phase:", await fy.getPhase(Channel.Main));
  console.log("output:", await fy.getOutput(Channel.Main));
} finally {
  await fy.close();
}
