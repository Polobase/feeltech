/**
 * Send commands and print raw byte responses (hex + text).
 *
 *   npm run example:raw:bytes -- [port]
 */
import { SerialPort } from "serialport";

const path = process.argv[2];
if (!path) {
  console.error("Usage: pass the serial port path, e.g. /dev/cu.wchusbserial1220");
  process.exit(1);
}

const port = new SerialPort({ path, baudRate: 115200, dataBits: 8, stopBits: 2, parity: "none", autoOpen: false });
await new Promise<void>((res, rej) => port.open((e) => (e ? rej(e) : res())));

let buf: number[] = [];
port.on("data", (chunk: Buffer) => { for (const b of chunk) buf.push(b); });

async function send(cmd: string, waitMs = 1000) {
  buf = [];
  port.write(cmd + "\n");
  await new Promise((r) => setTimeout(r, waitMs));
  const hex = buf.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const txt = String.fromCharCode(...buf).replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  console.log(`>>> ${cmd}`);
  console.log(`<<< len=${buf.length}  hex: ${hex}`);
  console.log(`<<< text: "${txt}"`);
}

await send("UMO");
await send("WMF00001000.000000");
await send("RMF");
await send("WMA1.0000");
await send("RMA");

await new Promise<void>((res) => port.close(() => res()));
