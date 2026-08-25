/**
 * PM modulation: 1 kHz sine modulated by 500 Hz square.
 *
 *   npm run example:mod:pm -- [port]
 */
import { connectNode, Channel, ModulationMode, ModulationSource } from "../../src/index.js";

const path = process.argv[2];
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

  await fy.setModulationMode(ModulationMode.PM);
  await fy.setModulationSource(ModulationSource.CH2);
  await fy.setPmPhaseOffset(90);

  console.log("PM: 1 kHz sine modulated by 500 Hz square, phase offset 90 deg");
} finally {
  await fy.close();
}
