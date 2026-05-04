/**
 * Display device information and current state for both channels.
 *
 *   pnpm example:info -- /dev/cu.wchusbserial1220
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";
console.log(`Connecting to ${path}...`);

const fy = await connectNode(path, { debug: false });

try {
  console.log(`\n--- Device Info ---`);
  console.log(`  Model:       ${fy.deviceModel}`);
  console.log(`  ID:          ${fy.deviceId}`);
  console.log(`  Family:      ${fy.family}`);
  console.log(`  Buzzer:      ${await fy.getBuzzer()}`);
  console.log(`  Uplink:      ${await fy.getUplink()}`);
  console.log(`  Cascade:     ${await fy.getCascadeRole()}`);

  for (const ch of [Channel.Main, Channel.Aux]) {
    const label = ch === Channel.Main ? "CH1 (main)" : "CH2 (aux)";
    const s = await fy.getChannelState(ch);
    console.log(`\n--- ${label} ---`);
    console.log(`  Waveform:    ${s.waveformName} (code=${s.waveform})`);
    console.log(`  Frequency:   ${s.frequencyHz} Hz`);
    console.log(`  Amplitude:   ${s.amplitudeV} V`);
    console.log(`  Offset:      ${s.offsetV} V`);
    console.log(`  Duty:        ${s.dutyCyclePct} %`);
    console.log(`  Phase:       ${s.phaseDeg} deg`);
    console.log(`  Output:      ${s.enabled ? "ON" : "off"}`);
  }
} finally {
  await fy.close();
}
