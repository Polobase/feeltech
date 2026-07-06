/**
 * Read all measurement values from the frequency counter.
 *
 * The first readMeasurement() call switches the device into measurement mode
 * and returns bogus values. Wait the gate time, then read again for real data.
 *
 *   npm run example:measure -- [port]
 */
import { connectNode } from "../../src/index.js";

const path = process.argv[2];
const fy = await connectNode(path, { debug: false });

try {
  // First call enters measurement mode (results are bogus)
  console.log("Entering measurement mode...");
  await fy.readMeasurement();

  console.log("Measuring for 2 seconds...");
  await new Promise((r) => setTimeout(r, 2000));

  const m = await fy.readMeasurement();
  console.log("\n--- Measurement ---");
  console.log(`  Frequency:        ${m.frequencyHz} Hz`);
  console.log(`  Count:            ${m.count}`);
  console.log(`  Period:           ${m.periodNs} ns`);
  console.log(`  Positive pulse:   ${m.positivePulseNs} ns`);
  console.log(`  Negative pulse:   ${m.negativePulseNs} ns`);
  console.log(`  Duty cycle:       ${m.dutyCyclePct} %`);
  console.log(`  Gate time:        ${m.gateTime}`);
} finally {
  await fy.close();
}
