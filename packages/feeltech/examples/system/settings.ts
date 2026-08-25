/**
 * System settings: buzzer, uplink, cascade, save/load state, sync.
 *
 *   npm run example:system -- [port]
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2];
const fy = await connectNode(path, { debug: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  console.log("\n--- System Settings ---");

  // Buzzer
  await fy.setBuzzer(true);
  console.log("Buzzer ON");
  await sleep(500);
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

  // Save / Load — slot 2 on purpose: slot 1 is auto-loaded at power-on, so a
  // demo shouldn't overwrite it. USN snapshots the applied state, so give the
  // device a moment to settle before saving (see docs/serial_protocol.md).
  await fy.configureChannel(Channel.Main, {
    waveform: "Sine",
    frequencyHz: 1234,
    amplitudeV: 1.5,
    enabled: false,
  });
  await sleep(500);
  await fy.saveState(2);
  console.log("Saved current state to slot 2");

  await fy.configureChannel(Channel.Main, {
    waveform: "Square",
    frequencyHz: 5678,
    amplitudeV: 2.5,
    enabled: true,
  });
  console.log("Changed to square 5.678 kHz");
  await sleep(1000);

  await fy.loadState(2);
  await sleep(1500);
  console.log("Restored state from slot 2");
  const restored = await fy.getChannelState(Channel.Main);
  console.log(`Restored: ${restored.waveformName} @ ${restored.frequencyHz} Hz`);

  // Sync
  await fy.enableSync(0);
  console.log("Sync enabled");
  const syncState = await fy.readSync(0);
  console.log(`Sync state: ${syncState}`);
  await fy.disableSync(0);
  console.log("Sync disabled");
} finally {
  await fy.setOutput(Channel.Main, false);
  await fy.close();
}
