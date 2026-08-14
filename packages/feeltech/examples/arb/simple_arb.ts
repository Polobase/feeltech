/**
 * Test arbitrary waveform upload with simpler approach.
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2];
const fy = await connectNode(path, { debug: true });

try {
  // Switch away from arb1 before uploading to it.
  await fy.setWaveform(Channel.Main, "Sine");

  const values: number[] = [];
  for (let i = 0; i < 8192; i++) {
    values.push(i / 8192);
  }

  console.log("Uploading...");
  await fy.uploadWaveform(1, values, { minValue: 0, maxValue: 1 });
  console.log("Upload complete!");

  await fy.configureChannel(Channel.Main, {
    waveform: "Arbitrary1",
    frequencyHz: 1000,
    amplitudeV: 3,
    enabled: true,
  });
  console.log("CH1: arbitrary waveform 1 (stairstep), 1 kHz, 3 Vpp");
} finally {
  await fy.close();
}
