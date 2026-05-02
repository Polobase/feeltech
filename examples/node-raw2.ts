/**
 * Variation: try different init / timing scenarios and observe.
 */
import { NodeSerialTransport } from "../src/transports/node.js";

const path = process.argv[2] ?? "/dev/cu.wchusbserial1220";

async function trial(label: string, fn: (t: NodeSerialTransport) => Promise<void>) {
  console.log(`\n=== ${label} ===`);
  const t = new NodeSerialTransport(path);
  await t.open({ baudRate: 115200, dataBits: 8, stopBits: 2, parity: "none" });
  try {
    await fn(t);
  } finally {
    await t.close();
  }
}

async function readManyLines(t: NodeSerialTransport, max = 5, idleMs = 400) {
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

// 1: NO init, just immediate UMO
await trial("trial 1: no init, UMO immediately", async (t) => {
  await t.write("UMO\n");
  console.log("lines:", await readManyLines(t));
});

// 2: short delay before UMO
await trial("trial 2: 1s delay, then UMO", async (t) => {
  await new Promise((r) => setTimeout(r, 1000));
  await t.write("UMO\n");
  console.log("lines:", await readManyLines(t));
});

// 3: init with \n\n\n, sleep, then UMO
await trial("trial 3: \\n\\n\\n init, 500ms, then UMO", async (t) => {
  await t.write("\n\n\n");
  await new Promise((r) => setTimeout(r, 500));
  await t.write("UMO\n");
  console.log("lines:", await readManyLines(t));
});

// 4: stop bits 1 (FY2300-style)
console.log("\n=== trial 4: stop bits = 1 ===");
{
  const t = new NodeSerialTransport(path);
  await t.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none" });
  try {
    await t.write("UMO\n");
    console.log("lines:", await readManyLines(t));
  } finally {
    await t.close();
  }
}
