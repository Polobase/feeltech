/**
 * Cycle through all available waveforms on CH1.
 *
 *   pnpm example:allwaves -- /dev/cu.wchusbserial110
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial110";
const fy = await connectNode(path, { debug: false });

try {
  const waves = fy.listWaveforms(Channel.Main);
  console.log(`Found ${waves.length} waveforms for ${fy.family}:`);

  // Set a safe carrier first
  await fy.configureChannel(Channel.Main, {
    frequencyHz: 10000,
    amplitudeV: 2,
    offsetV: 0,
    enabled: true,
  });

  for (const w of waves) {
    await fy.setWaveform(Channel.Main, w.code);
    console.log(`  ${w.code.toString().padStart(3)}: ${w.name}`);
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\nDone — disabling output.");
  await fy.setOutput(Channel.Main, false);
} finally {
  await fy.close();
}
