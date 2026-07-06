/**
 * FSK: triangle wave alternating between 1 kHz and 2 kHz each second.
 *
 *   npm run example:mod:fsk -- [port]
 */
import { connectNode, Channel, ModulationMode, ModulationSource } from "../../src/index.js";

const path = process.argv[2];
const fy = await connectNode(path, { debug: true });

try {
  await fy.configureChannel(Channel.Main, {
    waveform: "Triangle",
    frequencyHz: 1000,
    amplitudeV: 3,
    enabled: true,
  });

  await fy.configureChannel(Channel.Aux, {
    waveform: "Square",
    frequencyHz: 1,
    amplitudeV: 3,
    enabled: true,
  });

  await fy.setModulationMode(ModulationMode.FSK);
  await fy.setModulationSource(ModulationSource.CH2);
  await fy.setFskFrequency(2000);

  console.log("FSK: triangle 1 kHz / 2 kHz toggled by 1 Hz square on CH2");
} finally {
  await fy.close();
}
