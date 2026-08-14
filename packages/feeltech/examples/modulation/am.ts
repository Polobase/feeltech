/**
 * AM modulation: 2 kHz sine modulated by 150 Hz triangle.
 *
 *   npm run example:mod:am -- [port]
 */
import { connectNode, Channel, ModulationMode, ModulationSource } from "../../src/index.js";

const path = process.argv[2];
const fy = await connectNode(path, { debug: true });

try {
  await fy.configureChannel(Channel.Main, {
    waveform: "Sine",
    frequencyHz: 2000,
    amplitudeV: 3,
    enabled: true,
  });

  await fy.configureChannel(Channel.Aux, {
    waveform: "Triangle",
    frequencyHz: 150,
    amplitudeV: 3,
    enabled: true,
  });

  await fy.setModulationMode(ModulationMode.AM);
  await fy.setModulationSource(ModulationSource.CH2);
  await fy.setAmModulationRate(90);

  console.log("AM: 2 kHz sine modulated by 150 Hz triangle at 90 % depth");
} finally {
  await fy.close();
}
