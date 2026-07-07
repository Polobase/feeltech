/**
 * Cycle through all available waveforms on CH1.
 *
 *   npm run example:allwaves -- [port]
 */
import { connectNode, Channel, FeelTechVerifyError } from "../../src/index.js";

const path = process.argv[2];
const fy = await connectNode(path, { debug: false });

try {
  const waves = fy.listWaveforms(Channel.Main);
  console.log(`Found ${waves.length} waveforms for the ${fy.family} family:`);

  // Set a safe carrier first
  await fy.configureChannel(Channel.Main, {
    frequencyHz: 10000,
    amplitudeV: 2,
    offsetV: 0,
    enabled: true,
  });

  const unsupported: string[] = [];
  for (const w of waves) {
    try {
      await fy.setWaveform(Channel.Main, w.code);
      console.log(`  ${w.code.toString().padStart(3)}: ${w.name}`);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      // The waveform table is family-level; a specific model may support
      // fewer codes (e.g. the FY6300-60M clamps at Arbitrary61).
      if (!(err instanceof FeelTechVerifyError)) throw err;
      unsupported.push(`${w.code}: ${w.name}`);
    }
  }
  if (unsupported.length > 0) {
    console.log(`\nNot supported by ${fy.deviceModel}: ${unsupported.join(", ")}`);
  }

  console.log("\nDone — disabling output.");
  await fy.setOutput(Channel.Main, false);
} finally {
  await fy.close();
}
