/**
 * Demo mode — continuously cycles through examples for demonstration purposes.
 *
 *   pnpm example:demo -- /dev/cu.wchusbserial110
 */
import { connectNode, Channel } from "../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial110";
const fy = await connectNode(path, { debug: false });

const DELAY_MS = 3000;

async function wait(label: string, ms: number) {
  console.log(`  [${label}]`);
  await new Promise((r) => setTimeout(r, ms));
}

async function demoBasicWaveforms() {
  console.log("\n=== Basic Waveforms ===");
  const waves = ["Sine", "Square", "Triangle", "Ramp", "NegRamp", "Stairstep", "ECG", "Sinc-Pulse"];
  for (const wave of waves) {
    await fy.configureChannel(Channel.Main, {
      waveform: wave,
      frequencyHz: 1000,
      amplitudeV: 3,
      enabled: true,
    });
    await wait(`${wave} @ 1 kHz`, DELAY_MS);
  }
}

async function demoSweep() {
  console.log("\n=== Frequency Sweep ===");
  await fy.configureChannel(Channel.Main, {
    waveform: "Sine",
    frequencyHz: 100,
    amplitudeV: 3,
    enabled: true,
  });
  
  await fy.configureSweep({
    object: 0,
    start: 100,
    end: 5000,
    timeSeconds: 2,
    mode: 0,
    source: 0,
  });
  
  await fy.startSweep();
  await wait("Sweeping 100 Hz → 5 kHz", 3000);
  await fy.stopSweep();
  
  await fy.configureSweep({
    object: 3,
    start: 10,
    end: 90,
    timeSeconds: 1.5,
    mode: 0,
    source: 0,
  });
  
  await fy.startSweep();
  await wait("Sweeping duty 10% → 90%", 2000);
  await fy.stopSweep();
}

async function demoModulation() {
  console.log("\n=== Modulation ===");
  
  // AM
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
  await fy.setModulationMode(4); // AM
  await fy.setModulationSource(0);
  await fy.setAmModulationRate(90);
  await wait("AM: 2kHz sine + 150Hz triangle", DELAY_MS);
  
  // FM
  await fy.setModulationMode(5); // FM
  await fy.setFmDeviation(500);
  await wait("FM: 2kHz sine + 150Hz triangle", DELAY_MS);
  
  // Burst
  await fy.setModulationMode(3); // Burst
  await fy.setBurstCount(5);
  await wait("Burst: 5 cycles per trigger", DELAY_MS);
}

async function demoArbitrary() {
  console.log("\n=== Arbitrary Waveforms ===");
  
  // Switch away before uploading
  await fy.setWaveform(Channel.Main, "Sine");
  
  // Stairstep
  const stairstep = Array.from({ length: 8192 }, (_, i) => i / 8192);
  await fy.uploadWaveform(1, stairstep, { minValue: 0, maxValue: 1 });
  
  await fy.configureChannel(Channel.Main, {
    waveform: "Arbitrary1",
    frequencyHz: 1000,
    amplitudeV: 3,
    enabled: true,
  });
  await wait("Stairstep arbitrary waveform", DELAY_MS);
  
  // Ramp down
  const rampDown = Array.from({ length: 8192 }, (_, i) => 1 - i / 8192);
  await fy.uploadWaveform(2, rampDown, { minValue: 0, maxValue: 1 });
  
  await fy.configureChannel(Channel.Main, {
    waveform: "Arbitrary2",
    frequencyHz: 1000,
    amplitudeV: 3,
    enabled: true,
  });
  await wait("Ramp-down arbitrary waveform", DELAY_MS);
}

async function demoAmplitudeDuty() {
  console.log("\n=== Amplitude & Duty Cycle ===");
  await fy.configureChannel(Channel.Main, {
    waveform: "Square",
    frequencyHz: 1000,
    enabled: true,
  });
  
  const amplitudes = [0.5, 1, 2, 5, 10, 3];
  for (const amp of amplitudes) {
    await fy.setAmplitude(Channel.Main, amp);
    await wait(`Amplitude ${amp} V`, 1500);
  }
  
  const duties = [10, 25, 50, 75, 90];
  for (const duty of duties) {
    await fy.setDutyCycle(Channel.Main, duty);
    await wait(`Duty cycle ${duty}%`, 1500);
  }
}

async function demoFrequencyRange() {
  console.log("\n=== Frequency Range ===");
  await fy.configureChannel(Channel.Main, {
    waveform: "Sine",
    amplitudeV: 3,
    enabled: true,
  });
  
  const freqs = [1, 10, 100, 1000, 10000, 50000, 1000];
  for (const freq of freqs) {
    await fy.setFrequency(Channel.Main, freq);
    await wait(`${freq} Hz`, 2000);
  }
}

async function demoPhase() {
  console.log("\n=== Phase Shift ===");
  await fy.configureChannel(Channel.Main, {
    waveform: "Sine",
    frequencyHz: 1000,
    amplitudeV: 3,
    enabled: true,
  });
  await fy.configureChannel(Channel.Aux, {
    waveform: "Sine",
    frequencyHz: 1000,
    amplitudeV: 3,
    enabled: true,
  });
  
  const phases = [0, 45, 90, 135, 180, 225, 270, 315];
  for (const phase of phases) {
    await fy.setPhase(Channel.Aux, phase);
    await wait(`CH2 phase ${phase}°`, 1500);
  }
}

async function runDemo() {
  try {
    console.log(`Connected to ${fy.deviceModel} (${fy.family})`);
    console.log("Starting demo mode... Press Ctrl+C to stop\n");
    
    while (true) {
      await demoBasicWaveforms();
      await demoAmplitudeDuty();
      await demoFrequencyRange();
      await demoPhase();
      await demoSweep();
      await demoModulation();
      await demoArbitrary();
      
      console.log("\n=== Demo cycle complete, restarting... ===");
    }
  } finally {
    await fy.setOutput(Channel.Main, false);
    await fy.setOutput(Channel.Aux, false);
    await fy.close();
  }
}

runDemo().catch((err) => {
  console.error("Demo error:", err);
  process.exit(1);
});
