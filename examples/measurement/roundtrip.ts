/**
 * Round-trip test: write then immediately read each parameter, verify they match.
 *
 *   pnpm example:roundtrip -- /dev/cu.wchusbserial110
 */
import { connectNode, Channel } from "../../src/index.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial110";
const fy = await connectNode(path, { debug: true, readTimeoutMs: 1000 });

async function check(label: string, write: () => Promise<void>, read: () => Promise<number>, expected: number, tol = 0.01) {
  await write();
  const got = await read();
  const ok = Math.abs(got - expected) <= tol * Math.max(Math.abs(expected), 1);
  console.log(`${ok ? "✓" : "✗"} ${label}: expected=${expected}  got=${got}`);
}

try {
  await check("freq=1000",   () => fy.setFrequency(Channel.Main, 1000),   () => fy.getFrequency(Channel.Main), 1000);
  await check("amp=3.3",     () => fy.setAmplitude(Channel.Main, 3.3),    () => fy.getAmplitude(Channel.Main), 3.3);
  await check("offset=0",    () => fy.setOffset(Channel.Main, 0),         () => fy.getOffset(Channel.Main), 0, 0.001);
  await check("duty=50",     () => fy.setDutyCycle(Channel.Main, 50),     () => fy.getDutyCycle(Channel.Main), 50);
  await check("phase=0",     () => fy.setPhase(Channel.Main, 0),          () => fy.getPhase(Channel.Main), 0, 0.001);
} finally {
  await fy.setOutput(Channel.Main, false);
  await fy.close();
}
