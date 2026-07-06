/**
 * System settings: buzzer, uplink, sync, cascade, save/load state.
 *
 *   npm run example:system -- [port]
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2];
const fy = await connectNode(path, { debug: false });

try {
  console.log("\n--- System Settings ---");

  // Buzzer
  await fy.setBuzzer(true);
  console.log("Buzzer ON");
  await new Promise((r) => setTimeout(r, 500));
  await fy.setBuzzer(false);
  console.log("Buzzer OFF");

  // Uplink
  const uplinkBefore = await fy.getUplink();
  console.log(`Uplink before: ${uplinkBefore}`);
  await fy.setUplink(!uplinkBefore);
  console.log(`Uplink after:  ${await fy.getUplink()}`);
  await fy.setUplink(uplinkBefore);

  // Cascade
  const cascadeBefore = await fy.getCascadeRole();
  console.log(`Cascade role: ${cascadeBefore}`);

  // Sync
  await fy.enableSync(0);
  console.log("Sync enabled");
  const syncState = await fy.readSync(0);
  console.log(`Sync state: ${syncState}`);
  await fy.disableSync(0);
  console.log("Sync disabled");

  // Save / Load
  await fy.configureChannel(Channel.Main, {
    waveform: "Sine",
    frequencyHz: 1234,
    amplitudeV: 1.5,
    enabled: false,
  });
  await fy.saveState(1);
  console.log("Saved current state to slot 1");

  await fy.configureChannel(Channel.Main, {
    waveform: "Square",
    frequencyHz: 5678,
    amplitudeV: 2.5,
    enabled: true,
  });
  console.log("Changed to square 5.678 kHz");
  await new Promise((r) => setTimeout(r, 1000));

  await fy.loadState(1);
  console.log("Restored state from slot 1");
  const restored = await fy.getChannelState(Channel.Main);
  console.log(`Restored: ${restored.waveformName} @ ${restored.frequencyHz} Hz`);
} finally {
  await fy.setOutput(Channel.Main, false);
  await fy.close();
}
