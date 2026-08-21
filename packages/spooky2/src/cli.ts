#!/usr/bin/env node
/**
 * `spooky2` command-line tool (Node-only).
 *
 *   spooky2 devices                        # supported drivers + verification status
 *   spooky2 list                           # serial ports
 *   spooky2 set --device xm --freq 727.5 --amp 20 --on
 *   spooky2 set --device xm --off
 *
 * None of these drivers is hardware-verified — `devices` says so per driver,
 * and `set` prints a warning before it writes anything.
 */

import { parseArgs, type ParseArgsConfig } from "node:util";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { AwgError, DeviceRegistry, type ChannelStep } from "@freqgen/core";
import { NodeSerialTransport, listPorts, describeBridge } from "@freqgen/core/node";

import { SPOOKY2_DEVICES } from "./devices.js";
import { parsePreset, presetToProgram } from "./presets.js";
import { runPresetRun } from "./run-preset.js";

const registry = new DeviceRegistry().registerAll(SPOOKY2_DEVICES);

const GLOBAL_OPTIONS: NonNullable<ParseArgsConfig["options"]> = {
  device: { type: "string", short: "d" },
  port: { type: "string", short: "p" },
  json: { type: "boolean" },
  debug: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

const COMMAND_OPTIONS: Record<string, NonNullable<ParseArgsConfig["options"]>> = {
  devices: {},
  list: {},
  set: {
    channel: { type: "string", default: "1" },
    waveform: { type: "string" },
    freq: { type: "string" },
    amp: { type: "string" },
    offset: { type: "string" },
    duty: { type: "string" },
    phase: { type: "string" },
    on: { type: "boolean" },
    off: { type: "boolean" },
  },
  "run-preset": {
    preset: { type: "string" },
    channels: { type: "string" },
    "sweep-steps": { type: "string" },
  },
};

const USAGE = `Usage: spooky2 <command> [options]

Commands:
  devices                    List supported drivers and their verification status
  list                       List serial ports
  set                        Apply channel settings
                             --device xm|genx|genx-pro  --channel 1|2
                             --waveform sine|square|... --freq <Hz> --amp <Vpp>
                             --offset <V> --duty <pct> --phase <deg>  --on | --off
  run-preset                 Run a Spooky2 preset file on a generator
                             --device xm|genx|genx-pro  --preset <file.txt>
                             --channels 1|2|1,2  --sweep-steps <n>

Global options:
  -d, --device <id>          Driver to use (see \`spooky2 devices\`)
  -p, --port <path>          Serial port path
      --json                 Machine-readable output
      --debug                Log serial traffic
  -h, --help                 Show this help

No driver in this package has been verified against hardware. Confirm output
with a scope before relying on it.`;

export interface ParsedCli {
  command: string;
  values: Record<string, string | boolean | (string | boolean)[] | undefined>;
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    return { command: "help", values: {} };
  }
  const options = COMMAND_OPTIONS[command];
  if (!options) {
    throw new AwgError(`Unknown command "${command}" — run \`spooky2 --help\``);
  }
  const { values } = parseArgs({
    args: rest,
    options: { ...GLOBAL_OPTIONS, ...options },
    allowPositionals: false,
  });
  if (values["on"] && values["off"]) {
    throw new AwgError("--on and --off are mutually exclusive");
  }
  return { command, values };
}

function parseNumber(name: string, value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new AwgError(`--${name} must be a number, got ${value}`);
  return n;
}

function parseChannel(value: unknown): number {
  const n = Number(value ?? 1);
  if (n !== 1 && n !== 2) throw new AwgError(`--channel must be 1 or 2, got ${value}`);
  return n - 1;
}

function cmdDevices(json: boolean | undefined): void {
  const rows = registry.list();
  if (json) {
    console.log(JSON.stringify(rows.map(({ create: _, ...r }) => r), null, 2));
    return;
  }
  for (const d of rows) {
    const mark = d.verified === true ? "✅" : d.verified === "partial" ? "◐" : "⚠️";
    console.log(`${mark}  ${d.id.padEnd(10)} ${d.label}`);
    if (d.note) console.log(`    ${d.note}`);
  }
  console.log("\n⚠️  = implemented from protocol documentation, never verified on hardware.");
}

async function cmdList(json: boolean | undefined): Promise<void> {
  const ports = await listPorts();
  if (json) {
    console.log(JSON.stringify(ports, null, 2));
    return;
  }
  if (ports.length === 0) {
    console.log("No serial ports found.");
    return;
  }
  for (const p of ports) {
    const bridge = describeBridge(p);
    const tag = bridge ? `[${bridge.label}${bridge.dualPort ? ", dual-port" : ""}]` : "";
    console.log(`${bridge ? "*" : " "} ${p.path}  ${tag}`.trimEnd());
  }
  console.log("(* = a USB-serial bridge these generators are known to use)");
}

async function cmdSet(values: ParsedCli["values"]): Promise<void> {
  const deviceId = values["device"] ? String(values["device"]) : undefined;
  if (!deviceId) {
    throw new AwgError("--device is required — run `spooky2 devices` to see the options");
  }
  const path = values["port"] ? String(values["port"]) : undefined;
  if (!path) {
    throw new AwgError("--port is required — run `spooky2 list` to find it");
  }

  const step: ChannelStep = {};
  if (values["waveform"] !== undefined) {
    const raw = String(values["waveform"]);
    step.waveform = /^\d+$/.test(raw) ? Number(raw) : (raw as ChannelStep["waveform"]);
  }
  if (values["freq"] !== undefined) step.frequencyHz = parseNumber("freq", values["freq"]);
  if (values["amp"] !== undefined) step.amplitudeVpp = parseNumber("amp", values["amp"]);
  if (values["offset"] !== undefined) step.offsetV = parseNumber("offset", values["offset"]);
  if (values["duty"] !== undefined) step.dutyCyclePct = parseNumber("duty", values["duty"]);
  if (values["phase"] !== undefined) step.phaseDeg = parseNumber("phase", values["phase"]);
  if (values["on"]) step.output = true;
  if (values["off"]) step.output = false;
  if (Object.keys(step).length === 0) {
    throw new AwgError("set: nothing to do — pass at least one parameter");
  }

  const descriptor = registry.get(deviceId);
  if (descriptor && descriptor.verified !== true) {
    console.error(
      `⚠️  ${descriptor.label} is not hardware-verified — confirm output with a scope.`,
    );
  }

  const channel = parseChannel(values["channel"]);
  const device = registry.create(deviceId, new NodeSerialTransport(path), {
    debug: values["debug"] === true,
  });
  await device.open();
  try {
    await device.applyStep(channel, step);
    console.log(`Applied to ${descriptor?.label ?? deviceId} channel ${channel + 1}.`);
  } finally {
    await device.close();
  }
}

async function cmdRunPreset(values: ParsedCli["values"]): Promise<void> {
  const deviceId = values["device"] ? String(values["device"]) : undefined;
  if (!deviceId) {
    throw new AwgError("--device is required — run `spooky2 devices` to see the options");
  }
  const path = values["port"] ? String(values["port"]) : undefined;
  if (!path) {
    throw new AwgError("--port is required — run `spooky2 list` to find it");
  }
  const presetPath = values["preset"] ? String(values["preset"]) : undefined;
  if (!presetPath) throw new AwgError("--preset is required (path to a Spooky2 .txt preset)");

  const text = readFileSync(presetPath, "utf8");
  const channels = parseChannels(values["channels"]);
  const sweepSteps = values["sweep-steps"] !== undefined
    ? parseNumber("sweep-steps", values["sweep-steps"])
    : undefined;
  const run = presetToProgram(parsePreset(text), {
    channels,
    ...(sweepSteps !== undefined ? { sweepSteps } : {}),
  });

  for (const warning of run.warnings) console.error(`⚠️  ${warning}`);

  const descriptor = registry.get(deviceId);
  if (descriptor && descriptor.verified !== true) {
    console.error(
      `⚠️  ${descriptor.label} is not hardware-verified — confirm output with a scope.`,
    );
  }

  const device = registry.create(deviceId, new NodeSerialTransport(path), {
    debug: values["debug"] === true,
  });
  await device.open();
  try {
    console.log(
      `Running "${run.name}" (${run.segments.length} segments) on ` +
        `${descriptor?.label ?? deviceId}…`,
    );
    await runPresetRun(device, run, {
      onSegment: (i, seg) =>
        console.log(
          `  ${i + 1}/${run.segments.length}: ${
            seg.type === "step"
              ? `${seg.frequencyHz.toFixed(3)} Hz for ${seg.dwellSeconds}s`
              : `sweep ${seg.startHz.toFixed(3)}→${seg.endHz.toFixed(3)} Hz`
          }`,
        ),
    });
    console.log("Done.");
  } finally {
    await device.close();
  }
}

function parseChannels(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  const raw = String(value).split(",").map((s) => s.trim());
  return raw.map((s) => {
    const n = Number(s);
    if (n !== 1 && n !== 2) throw new AwgError(`--channels must be 1, 2, or 1,2 — got ${value}`);
    return n - 1;
  });
}

export async function run(argv: string[]): Promise<void> {
  const { command, values } = parseCliArgs(argv);
  if (command === "help" || values["help"]) {
    console.log(USAGE);
    return;
  }
  const json = values["json"] as boolean | undefined;
  switch (command) {
    case "devices":
      return cmdDevices(json);
    case "list":
      return cmdList(json);
    case "set":
      return cmdSet(values);
    case "run-preset":
      return cmdRunPreset(values);
    default:
      throw new AwgError(`Unknown command "${command}"`);
  }
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  run(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof AwgError ? err.message : err);
    process.exitCode = 1;
  });
}
