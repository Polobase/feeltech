/**
 * Upload a simple stairstep arbitrary waveform and output it on CH1.
 *
 *   pnpm example:arb -- /dev/cu.wchusbserial1220
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";
const fy = await connectNode(path, { debug: true });

try {
  // Note: arbitrary waveform upload is not yet implemented in this library.
  // This example demonstrates selecting an arbitrary waveform slot.
  console.log("Selecting arbitrary waveform slot 1 on CH1...");

  await fy.configureChannel(Channel.Main, {
    waveform: "Arbitrary1",
    frequencyHz: 1000,
    amplitudeV: 3,
    enabled: true,
  });

  console.log("CH1: arbitrary waveform 1, 1 kHz, 3 Vpp");
} finally {
  await fy.close();
}
