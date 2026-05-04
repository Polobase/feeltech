/**
 * XY G-code Plot — reads a simple G-code file and creates an XY plot on CH1/CH2.
 *
 *   pnpm example:gcode -- /dev/cu.wchusbserial110 examples/gcode/star.gcd
 *
 * The G-code parser supports G01 (linear move) commands with X, Y, Z (pen up/down).
 * The path is interpolated to 8192 points and output as arbitrary waveforms.
 *
 * Note: Arbitrary waveform upload is not yet implemented in this library.
 *       This example prepares the interpolated data. Once upload is supported,
 *       the data can be sent to arbitrary waveform slots.
 */
import { connectNode, Channel } from "../../src/index.js";
import { readFileSync } from "fs";

const path = process.argv[2] ?? "/dev/cu.wchusbserial110";
const filename = process.argv[3] ?? "examples/gcode/star.gcd";
const DATA_LENGTH = 8192;

interface Point { x: number; y: number; penDown: boolean }

function parseGcodeLine(line: string): Record<string, number> {
  const commentIdx = line.indexOf(";");
  if (commentIdx >= 0) line = line.slice(0, commentIdx);
  const d: Record<string, number> = {};
  for (const token of line.trim().split(/\s+/)) {
    if (token.length < 2) continue;
    const key = token[0]!.toUpperCase();
    d[key] = parseFloat(token.slice(1));
  }
  return d;
}

function readGcode(content: string): Point[] {
  const data: Point[] = [];
  let x = 0, y = 0, penDown = true;

  for (const line of content.split("\n")) {
    const d = parseGcodeLine(line);
    if (!("G" in d)) continue;
    if (Math.round(d["G"]!) !== 1) continue;

    const newPenDown = "Z" in d ? Math.round(d["Z"]!) === 0 : penDown;
    if ("X" in d) x = d["X"]!;
    if ("Y" in d) y = d["Y"]!;

    if (newPenDown || penDown) {
      data.push({ x, y, penDown: newPenDown });
    }
    penDown = newPenDown;
  }

  while (data.length > 0 && !data[data.length - 1]!.penDown) {
    data.pop();
  }
  return data;
}

function lineLength(p1: Point, p2: Point): number {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

function calcLength(data: Point[]): number {
  let len = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i]!.penDown) len += lineLength(data[i - 1]!, data[i]!);
  }
  return len;
}

function interpolate(data: Point[]): Point[] {
  const length = calcLength(data);
  const segmentSize = length / DATA_LENGTH;
  console.log(`length=${length.toFixed(2)}  segment_size=${segmentSize.toFixed(4)}`);

  const out: Point[] = [data[0]!];
  for (let i = 1; i < data.length; i++) {
    const p1 = data[i - 1]!;
    const p2 = data[i]!;
    if (!p2.penDown) {
      out.push(p2);
      continue;
    }
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen <= 0) {
      out.push(p2);
      continue;
    }
    const steps = Math.floor(segLen / segmentSize);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      out.push({ x: p1.x + dx * t, y: p1.y + dy * t, penDown: true });
    }
    out.push(p2);
  }
  return out;
}

function boundCoordinates(data: Point[]): { xmin: number; ymin: number; xmax: number; ymax: number } {
  const xs = data.map((p) => p.x);
  const ys = data.map((p) => p.y);
  return {
    xmin: Math.min(...xs),
    ymin: Math.min(...ys),
    xmax: Math.max(...xs),
    ymax: Math.max(...ys),
  };
}

// Read and process G-code
const content = readFileSync(filename, "utf-8");
let data = readGcode(content);
console.log(`Read ${data.length} points from ${filename}`);

data = interpolate(data);
console.log(`Interpolated to ${data.length} points`);

// Reduce if too many points
while (data.length > DATA_LENGTH) {
  const remove = Math.max(1, Math.floor((data.length - DATA_LENGTH) / 10));
  console.log(`Reducing ${data.length} points by ${remove}...`);
  for (let r = 0; r < remove && data.length > DATA_LENGTH; r++) {
    let shortest = Infinity;
    let idx = -1;
    for (let i = 1; i < data.length - 1; i++) {
      if (!data[i]!.penDown) continue;
      const len = lineLength(data[i - 1]!, data[i]!) + lineLength(data[i]!, data[i + 1]!);
      if (len < shortest) { shortest = len; idx = i; }
    }
    if (idx > 0) data.splice(idx, 1);
  }
}

while (data.length < DATA_LENGTH) {
  data.push(data[data.length - 1]!);
}

const { xmin, xmax, ymin, ymax } = boundCoordinates(data);
console.log(`\nFinal: ${data.length} points`);
console.log(`X: ${xmin.toFixed(2)} .. ${xmax.toFixed(2)}`);
console.log(`Y: ${ymin.toFixed(2)} .. ${ymax.toFixed(2)}`);

const xValues = data.map((p) => p.x);
const yValues = data.map((p) => p.y);

console.log("\nNote: Arbitrary waveform upload not yet implemented.");
console.log("      Once supported, upload xValues to arb1 and yValues to arb2.");

const fy = await connectNode(path, { debug: false });
try {
  await fy.configureChannel(Channel.Main, {
    waveform: "Arbitrary1",
    frequencyHz: 1000,
    amplitudeV: 6,
    enabled: true,
  });
  await fy.configureChannel(Channel.Aux, {
    waveform: "Arbitrary2",
    frequencyHz: 1000,
    amplitudeV: 6,
    enabled: true,
  });
  console.log("\nSet both channels to 1 kHz, 6 Vpp, arbitrary waveforms 1 and 2.");
  console.log("Connect scope in XY mode to see the plot.");
} finally {
  await fy.close();
}
