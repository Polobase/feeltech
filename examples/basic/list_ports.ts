/**
 * List available serial ports on this machine.
 *
 *   npm run example:list
 */
import { listPorts } from "../../src/transports/node.js";

const ports = await listPorts();
if (ports.length === 0) {
  console.log("No serial ports found.");
} else {
  console.log(`Found ${ports.length} serial port(s):\n`);
  for (const p of ports) {
    console.log(`  ${p.path}`);
    if (p.manufacturer) console.log(`    manufacturer: ${p.manufacturer}`);
    if (p.vendorId) console.log(`    vendor:       ${p.vendorId}`);
    if (p.productId) console.log(`    product:      ${p.productId}`);
    if (p.serialNumber) console.log(`    serial:       ${p.serialNumber}`);
    console.log();
  }
}
