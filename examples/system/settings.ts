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
  // demo shouldn't overwrite it. The firmware occasionally acks a parameter
  // write without applying it and needs settle time before USN snapshots the
  // state (see docs/serial_protocol.md, known quirks) — so verify and retry.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await fy.configureChannel(Channel.Main, {
      waveform: "Sine",
      frequencyHz: 1234,
      amplitudeV: 1.5,
      enabled: false,
    });
    await sleep(800);
    const applied = await fy.getChannelState(Channel.Main);
    if (applied.frequencyHz === 1234 && applied.amplitudeV === 1.5) break;
    console.log("  (parameter write dropped by firmware — retrying)");
  }
  await sleep(800);
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

  // Sync — last on purpose: on some firmware (observed on FY6300-60M),
  // toggling sync can leave the panel in a state where subsequent channel
  // parameter writes are silently dropped for a while.
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
