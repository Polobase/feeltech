/**
 * PM modulation: 1 kHz sine modulated by 500 Hz square.
 *
 *   pnpm example:mod:pm -- /dev/cu.wchusbserial1220
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";
const fy = await connectNode(path, { debug: true });

try {
  await fy.configureChannel(Channel.Main, {
    waveform: "Sine",
    frequencyHz: 1000,
    amplitudeV: 3,
    enabled: true,
  });

  await fy.configureChannel(Channel.Aux, {
    waveform: "Square",
    frequencyHz: 500,
    amplitudeV: 3,
    enabled: true,
  });

  await fy.setModulationMode(4); // PM
  await fy.setModulationSource(0); // CH2 trigger
  await fy.setPmPhaseOffset(90);

  console.log("PM: 1 kHz sine modulated by 500 Hz square, phase offset 90 deg");
} finally {
  await fy.close();
}
