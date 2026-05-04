/**
 * XY Star Plot — interpolates a 5-point star and outputs it on CH1 (X) and CH2 (Y).
 *
 * Connect both channels to an oscilloscope in XY mode to see the star.
 *
 *   pnpm example:star -- /dev/cu.wchusbserial110
 *
 * Note: Arbitrary waveform upload is not yet implemented in this library.
 *       This example prepares the interpolated data. Once upload is supported,
 *       the data can be sent to arbitrary waveform slots 1 and 2.
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";
const DATA_LENGTH = 8192;

const POINTS: [number, number][] = [
  [0.3090,  0.9511],   // Pt 1
  [-0.8090, -0.5878],  // Pt 3
  [1.0000,  0.0000],   // Pt 5
  [-0.8090, 0.5878],   // Pt 2
  [0.3090, -0.9511],   // Pt 4
  [0.3090,  0.9511],   // Pt 1 (close)
];

function interpolateSegment(
  x1: number, y1: number,
  x2: number, y2: number,
  steps: number
): [number, number][] {
  const out: [number, number][] = [];
  const dx = (x2 - x1) / steps;
  const dy = (y2 - y1) / steps;
  for (let i = 0; i < steps; i++) {
    out.push([x1 + dx * i, y1 + dy * i]);
  }
  return out;
}

function interpolate(data: [number, number][]): [number, number][] {
  const lengths: number[] = [];
  for (let i = 0; i < data.length - 1; i++) {
    const [x1, y1] = data[i];
    const [x2, y2] = data[i + 1];
    lengths.push(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2));
  }

  const sumLength = lengths.reduce((a, b) => a + b, 0);
  const step = sumLength / DATA_LENGTH;
  console.log("lengths:", lengths.map((l) => l.toFixed(4)));

  const out: [number, number][] = [];
  for (let i = 0; i < data.length - 1; i++) {
    const [x1, y1] = data[i];
    const [x2, y2] = data[i + 1];
    out.push(...interpolateSegment(x1, y1, x2, y2, Math.floor(lengths[i]! / step)));
  }
  return out;
}

function pad(data: [number, number][]): [number, number][] {
  if (data.length === DATA_LENGTH) {
    console.log(`data is ${DATA_LENGTH} points`);
    return data;
  }
  if (data.length > DATA_LENGTH) {
    console.log(`Trim data from ${data.length} points to ${DATA_LENGTH}`);
    return data.slice(0, DATA_LENGTH);
  }
  console.log(`Extend data from ${data.length} points to ${DATA_LENGTH}`);
  while (data.length < DATA_LENGTH) {
    data.push(data[data.length - 1]!);
  }
  return data;
}

const data = pad(interpolate(POINTS));
const xValues = data.map(([x]) => x);
const yValues = data.map(([, y]) => y);

console.log(`\nPrepared ${data.length} points for XY star plot`);
console.log("X range:", Math.min(...xValues).toFixed(4), "to", Math.max(...xValues).toFixed(4));
console.log("Y range:", Math.min(...yValues).toFixed(4), "to", Math.max(...yValues).toFixed(4));
console.log("\nNote: Arbitrary waveform upload not yet implemented.");
console.log("      Once supported, upload xValues to arb1 and yValues to arb2.");

const fy = await connectNode(path, { debug: false });
try {
  // For now, just select arbitrary slots (data must be pre-loaded manually)
  await fy.configureChannel(Channel.Main, {
    waveform: "Arbitrary1",
    frequencyHz: 10000,
    amplitudeV: 6,
    enabled: true,
  });
  await fy.configureChannel(Channel.Aux, {
    waveform: "Arbitrary2",
    frequencyHz: 10000,
    amplitudeV: 6,
    enabled: true,
  });
  console.log("\nSet both channels to 10 kHz, 6 Vpp, arbitrary waveforms 1 and 2.");
  console.log("Connect scope in XY mode to see the star.");
} finally {
  await fy.close();
}
