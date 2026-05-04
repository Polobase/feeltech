/**
 * AM modulation: 2 kHz sine modulated by 150 Hz triangle.
 *
 *   pnpm example:mod:am -- /dev/cu.wchusbserial1220
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";
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

  await fy.setModulationMode(1); // AM
  await fy.setModulationSource(0); // CH2 trigger
  await fy.setAmModulationRate(90);

  console.log("AM: 2 kHz sine modulated by 150 Hz triangle at 90 % depth");
} finally {
  await fy.close();
}
