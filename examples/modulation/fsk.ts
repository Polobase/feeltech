/**
 * FSK: triangle wave alternating between 1 kHz and 2 kHz each second.
 *
 *   pnpm example:mod:fsk -- /dev/cu.wchusbserial1220
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";
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

  await fy.setModulationMode(3); // FSK
  await fy.setModulationSource(0); // CH2 trigger
  await fy.setFskFrequency(2000);

  console.log("FSK: triangle 1 kHz / 2 kHz toggled by 1 Hz square on CH2");
} finally {
  await fy.close();
}
