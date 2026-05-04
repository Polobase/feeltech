/**
 * FM modulation: 2 kHz sine modulated by 150 Hz triangle.
 *
 *   pnpm example:mod:fm -- /dev/cu.wchusbserial1220
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

  await fy.setModulationMode(2); // FM
  await fy.setModulationSource(0); // CH2 trigger
  await fy.setFmDeviation(500);

  console.log("FM: 2 kHz sine modulated by 150 Hz triangle, deviation 500 Hz");
} finally {
  await fy.close();
}
