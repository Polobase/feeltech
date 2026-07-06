/**
 * PSK: 1 kHz CMOS wave phase-shifted by 100 Hz square.
 *
 *   npm run example:mod:psk -- [port]
 */
import { connectNode, Channel, ModulationMode, ModulationSource } from "../../src/index.js";

const path = process.argv[2];
const fy = await connectNode(path, { debug: true });

try {
  await fy.configureChannel(Channel.Main, {
    waveform: "CMOS",
    frequencyHz: 1000,
    amplitudeV: 2.5,
    enabled: true,
  });

  await fy.configureChannel(Channel.Aux, {
    waveform: "Square",
    frequencyHz: 100,
    amplitudeV: 3,
    enabled: true,
  });

  await fy.setModulationMode(ModulationMode.PSK);
  await fy.setModulationSource(ModulationSource.CH2);

  console.log("PSK: 1 kHz CMOS phase-shifted by 100 Hz square on CH2");
} finally {
  await fy.close();
}
