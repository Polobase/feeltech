/**
 * Low-level dump: send commands, hex-print every byte that comes back.
 *
 *   npm run example:raw:dump -- [port]
 */
import { NodeSerialTransport } from "../../src/transports/node.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: pass the serial port path, e.g. /dev/cu.wchusbserial1220");
  process.exit(1);
}
const t = new NodeSerialTransport(path);
await t.open({ baudRate: 115200, dataBits: 8, stopBits: 2, parity: "none" });

async function send(cmd: string, label: string) {
  await t.write(cmd + "\n");
  console.log(`>>> ${label}: ${JSON.stringify(cmd + "\n")}`);
  for (let i = 0; i < 5; i++) {
    try {
      const line = await t.readLine(600);
      console.log(`<<< line ${i}: ${JSON.stringify(line)} (len=${line.length})`);
    } catch {
      console.log(`<<< (no more lines)`);
      break;
    }
  }
}

console.log("Sending init \\n\\n\\n then waiting 300ms...");
await t.write("\n\n\n");
await new Promise((r) => setTimeout(r, 300));
for (let i = 0; i < 10; i++) {
  try {
    const line = await t.readLine(100);
    console.log(`drain[${i}]: ${JSON.stringify(line)} (len=${line.length})`);
  } catch {
    console.log("drained.");
    break;
  }
}

await send("UMO", "UMO (read model)");
await send("UID", "UID (read id)");
await send("RMW", "RMW (read main waveform)");
await send("RMF", "RMF (read main frequency)");
await send("WMW00", "WMW00 (write main waveform=sine)");

await t.close();
