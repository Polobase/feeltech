/**
 * Burst: 10 kHz sine triggered by 1 kHz square, 3 cycles per burst.
 *
 *   pnpm example:mod:burst -- /dev/cu.wchusbserial110
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial110";
const fy = await connectNode(path, { debug: true });

try {
  await fy.configureChannel(Channel.Main, {
    waveform: "Sine",
    frequencyHz: 10000,
    amplitudeV: 3,
    enabled: true,
  });

  await fy.configureChannel(Channel.Aux, {
    waveform: "Square",
    frequencyHz: 1000,
    amplitudeV: 3,
    enabled: true,
  });

  await fy.setModulationMode(0); // Burst
  await fy.setModulationSource(0); // CH2 trigger
  await fy.setBurstCount(3);

  console.log("Burst: 10 kHz sine, 3 cycles per trigger, triggered by 1 kHz square on CH2");
} finally {
  await fy.close();
}
