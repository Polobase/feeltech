/**
 * Frequency counter: count pulses for 10 seconds.
 *
 * The first readPulseCount() call switches the device into counter mode.
 *
 *   npm run example:counter -- [port]
 */
import { connectNode } from "../../src/index.js";

const path = process.argv[2];
const fy = await connectNode(path, { debug: false });

try {
  // Enter counter mode (first read is bogus)
  await fy.readPulseCount();

  await fy.resetCounter();
  console.log("Counting for 10 seconds...");
  await new Promise((r) => setTimeout(r, 10000));
  const count = await fy.readPulseCount();
  console.log(`Count: ${count}`);
} finally {
  await fy.close();
}
