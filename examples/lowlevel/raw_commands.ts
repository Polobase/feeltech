/**
 * Send individual commands and print raw line responses.
 *
 *   npm run example:raw:cmd -- [port]
 */
import { NodeSerialTransport } from "../../src/transports/node.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: pass the serial port path, e.g. /dev/cu.wchusbserial1220");
  process.exit(1);
}
const t = new NodeSerialTransport(path);
await t.open({ baudRate: 115200, dataBits: 8, stopBits: 2, parity: "none" });

async function readManyLines(idleMs = 600, max = 10): Promise<string[]> {
  const lines: string[] = [];
  for (let i = 0; i < max; i++) {
    try {
      lines.push(await t.readLine(idleMs));
    } catch {
      break;
    }
  }
  return lines;
}

async function send(cmd: string) {
  await t.write(cmd + "\n");
  const lines = await readManyLines();
  console.log(`>>> ${JSON.stringify(cmd)}`);
  console.log(`<<< ${JSON.stringify(lines)} (${lines.length} lines)`);
}

await send("UMO");
await send("WMF00001000.000000");
await send("RMF");
await send("WMA1.0000");
await send("RMA");
await t.close();
