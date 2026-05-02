/**
 * Calibration probe: write a known value, read raw response,
 * print so we can derive the correct scaling factor.
 */
import { connectNode, Channel } from "../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";
const fy = await connectNode(path, { debug: false });

async function trial(label: string, set: () => Promise<void>, readCmd: string) {
  await set();
  const raw = await fy.sendRead(readCmd);
  console.log(`${label.padEnd(40)} raw="${raw}"`);
}

try {
  console.log("Family:", fy.family, "Model:", fy.deviceModel);
  console.log("");

  // Frequency
  await trial("Set freq=1000 Hz, RMF",      () => fy.setFrequency(Channel.Main, 1000), "RMF");
  await trial("Set freq=12345.678 Hz, RMF", () => fy.setFrequency(Channel.Main, 12345.678), "RMF");

  // Amplitude
  await trial("Set amp=1.000 V, RMA",  () => fy.setAmplitude(Channel.Main, 1.0), "RMA");
  await trial("Set amp=3.300 V, RMA",  () => fy.setAmplitude(Channel.Main, 3.3), "RMA");
  await trial("Set amp=0.100 V, RMA",  () => fy.setAmplitude(Channel.Main, 0.1), "RMA");

  // Offset
  await trial("Set offset= 0.000 V, RMO", () => fy.setOffset(Channel.Main, 0), "RMO");
  await trial("Set offset= 1.000 V, RMO", () => fy.setOffset(Channel.Main, 1.0), "RMO");
  await trial("Set offset=-1.234 V, RMO", () => fy.setOffset(Channel.Main, -1.234), "RMO");

  // Duty
  await trial("Set duty=50.0%, RMD", () => fy.setDutyCycle(Channel.Main, 50.0), "RMD");
  await trial("Set duty=25.5%, RMD", () => fy.setDutyCycle(Channel.Main, 25.5), "RMD");

  // Phase
  await trial("Set phase=0°, RMP",     () => fy.setPhase(Channel.Main, 0), "RMP");
  await trial("Set phase=90.0°, RMP",  () => fy.setPhase(Channel.Main, 90.0), "RMP");
  await trial("Set phase=180.0°, RMP", () => fy.setPhase(Channel.Main, 180.0), "RMP");

  // Output
  await trial("Set output ON,  RMN", () => fy.setOutput(Channel.Main, true), "RMN");
  await trial("Set output OFF, RMN", () => fy.setOutput(Channel.Main, false), "RMN");
} finally {
  // Leave device in safe state
  await fy.setOutput(Channel.Main, false);
  await fy.setOutput(Channel.Aux, false);
  await fy.close();
}
