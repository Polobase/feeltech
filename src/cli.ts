#!/usr/bin/env node
/**
 * `feeltech` command-line tool (Node-only).
 *
 *   feeltech list                             # list serial ports (FeelTech-likely flagged)
 *   feeltech info                             # model, id, family, channel states
 *   feeltech set --channel 1 --waveform sine --freq 1000 --amp 3.3 --on
 *   feeltech set --channel 1 --off
 *   feeltech sweep --object freq --start 100 --end 10000 --time 5 [--log]
 *   feeltech sweep --stop
 *   feeltech measure [--gate 1|10|100]
 *   feeltech upload --slot 1 --file wave.json [--resample] [--normalize]
 *   feeltech waveforms [--channel 1|2] [--family FY6900]
 *
 * Global options: --port/-p <path> (auto-detect when omitted), --family <F>,
 * --baud <n>, --debug, --json, --help/-h.
 */

import { parseArgs, type ParseArgsConfig } from "node:util";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  Channel,
  connectNode,
  FeelTech,
  FeelTechError,
  GateTime,
  listWaveforms,
  resampleWaveform,
  normalizeWaveform,
  SweepMode,
  SweepObject,
  type DeviceFamily,
  type FeelTechOptions,
} from "./index.js";
import { listPorts, FEELTECH_USB_VENDOR_IDS } from "./transports/node.js";

type OptionConfig = NonNullable<ParseArgsConfig["options"]>;

const GLOBAL_OPTIONS: OptionConfig = {
  port: { type: "string", short: "p" },
  family: { type: "string" },
  baud: { type: "string" },
  debug: { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

const COMMAND_OPTIONS: Record<string, OptionConfig> = {
  list: {},
  info: {},
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
  sweep: {
    object: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    time: { type: "string" },
    log: { type: "boolean" },
    stop: { type: "boolean" },
  },
  measure: {
    gate: { type: "string" },
  },
  upload: {
    slot: { type: "string" },
    file: { type: "string" },
    resample: { type: "boolean" },
    normalize: { type: "boolean" },
  },
  waveforms: {
    channel: { type: "string", default: "1" },
  },
};

const USAGE = `Usage: feeltech <command> [options]

Commands:
  list                       List serial ports (* = FeelTech-likely)
  info                       Show model, ID, family and both channel states
  set                        Set channel parameters
                             --channel 1|2 --waveform <name|code> --freq <Hz>
                             --amp <Vpp> --offset <V> --duty <pct> --phase <deg>
                             --on | --off
  sweep                      Configure + start a sweep, or stop it
                             --object freq|amp|offset|duty --start <v> --end <v>
                             --time <s> [--log]  |  --stop
  measure                    Read the frequency counter [--gate 1|10|100]
  waveforms                  List waveform names [--channel 1|2] [--family FY6900]
  upload                     Upload an arbitrary waveform
                             --slot <n> --file <path> [--resample] [--normalize]

Global options:
  -p, --port <path>          Serial port (auto-detected when omitted)
      --family <family>      Override family (FY2300 | FY6900)
      --baud <rate>          Override baud rate
      --debug                Log serial traffic
      --json                 Machine-readable output
  -h, --help                 Show this help`;

export interface ParsedCli {
  command: string;
  // parseArgs' value type; the array variant only occurs with `multiple: true`,
  // which no option here uses.
  values: Record<string, string | boolean | (string | boolean)[] | undefined>;
}

/** Parse CLI argv (without the node/script prefix). Throws FeelTechError on misuse. */
export function parseCliArgs(argv: string[]): ParsedCli {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { command: "help", values: {} };
  }
  const commandOptions = COMMAND_OPTIONS[command];
  if (!commandOptions) {
    throw new FeelTechError(`Unknown command "${command}" — run \`feeltech --help\``);
  }
  let values: ParsedCli["values"];
  try {
    ({ values } = parseArgs({
      args: rest,
      options: { ...GLOBAL_OPTIONS, ...commandOptions },
      allowPositionals: false,
      strict: true,
    }));
  } catch (err) {
    throw new FeelTechError(err instanceof Error ? err.message : String(err));
  }
  if (values["on"] && values["off"]) {
    throw new FeelTechError("--on and --off are mutually exclusive");
  }
  return { command, values };
}

/** Map a human channel number ("1"/"2") to the protocol Channel. */
export function parseChannel(value: unknown): Channel {
  if (value === "1" || value === undefined) return Channel.Main;
  if (value === "2") return Channel.Aux;
  throw new FeelTechError(`--channel must be 1 or 2, got ${value}`);
}

function parseNumber(name: string, value: unknown): number {
  const n = Number(value);
  if (typeof value !== "string" || value === "" || !Number.isFinite(n)) {
    throw new FeelTechError(`--${name} must be a number, got ${value}`);
  }
  return n;
}

function connectOptions(values: ParsedCli["values"]): FeelTechOptions {
  const options: FeelTechOptions = {};
  if (values["family"]) options.family = String(values["family"]) as DeviceFamily;
  if (values["baud"]) options.baudRate = parseNumber("baud", values["baud"]);
  if (values["debug"]) options.debug = true;
  return options;
}

async function withDevice<T>(
  values: ParsedCli["values"],
  fn: (fy: FeelTech) => Promise<T>,
): Promise<T> {
  const port = values["port"] ? String(values["port"]) : undefined;
  const fy = await connectNode(port, connectOptions(values));
  try {
    return await fn(fy);
  } finally {
    await fy.close();
  }
}

const print = (data: unknown, json: boolean | undefined, text: () => string): void => {
  console.log(json ? JSON.stringify(data, null, 2) : text());
};

async function cmdList(values: ParsedCli["values"]): Promise<void> {
  const ports = await listPorts();
  const isLikely = (p: { vendorId?: string }): boolean =>
    p.vendorId !== undefined &&
    (FEELTECH_USB_VENDOR_IDS as readonly string[]).includes(p.vendorId.toLowerCase());
  print(
    ports.map((p) => ({ ...p, feeltechLikely: isLikely(p) })),
    values["json"] as boolean | undefined,
    () =>
      ports.length === 0
        ? "No serial ports found."
        : ports
            .map(
              (p) =>
                `${isLikely(p) ? "*" : " "} ${p.path}  ${p.manufacturer ?? ""} ${
                  p.vendorId ? `[${p.vendorId}:${p.productId}]` : ""
                }`.trimEnd(),
            )
            .join("\n") + `\n(* = USB vendor ${FEELTECH_USB_VENDOR_IDS.join("/")})`,
  );
}

async function cmdInfo(values: ParsedCli["values"]): Promise<void> {
  await withDevice(values, async (fy) => {
    const ch1 = await fy.getChannelState(Channel.Main);
    const ch2 = await fy.getChannelState(Channel.Aux);
    const data = { model: fy.deviceModel, id: fy.deviceId, family: fy.family, ch1, ch2 };
    print(data, values["json"] as boolean | undefined, () =>
      [
        `Model:  ${data.model}`,
        `ID:     ${data.id}`,
        `Family: ${data.family}`,
        `CH1:    ${formatChannel(ch1)}`,
        `CH2:    ${formatChannel(ch2)}`,
      ].join("\n"),
    );
  });
}

function formatChannel(s: {
  waveformName?: string;
  waveform: number;
  frequencyHz: number;
  amplitudeV: number;
  offsetV: number;
  dutyCyclePct: number;
  phaseDeg: number;
  enabled: boolean;
}): string {
  return `${s.waveformName ?? s.waveform}  ${s.frequencyHz} Hz  ${s.amplitudeV} Vpp  offset ${s.offsetV} V  duty ${s.dutyCyclePct}%  phase ${s.phaseDeg}°  ${s.enabled ? "ON" : "off"}`;
}

async function cmdSet(values: ParsedCli["values"]): Promise<void> {
  const channel = parseChannel(values["channel"]);
  const cfg: Parameters<FeelTech["configureChannel"]>[1] = {};
  if (values["waveform"] !== undefined) {
    const raw = String(values["waveform"]);
    cfg.waveform = /^\d+$/.test(raw) ? Number(raw) : raw;
  }
  if (values["freq"] !== undefined) cfg.frequencyHz = parseNumber("freq", values["freq"]);
  if (values["amp"] !== undefined) cfg.amplitudeV = parseNumber("amp", values["amp"]);
  if (values["offset"] !== undefined) cfg.offsetV = parseNumber("offset", values["offset"]);
  if (values["duty"] !== undefined) cfg.dutyCyclePct = parseNumber("duty", values["duty"]);
  if (values["phase"] !== undefined) cfg.phaseDeg = parseNumber("phase", values["phase"]);
  if (values["on"]) cfg.enabled = true;
  if (values["off"]) cfg.enabled = false;
  if (Object.keys(cfg).length === 0) {
    throw new FeelTechError("set: nothing to do — pass at least one parameter");
  }
  await withDevice(values, async (fy) => {
    await fy.configureChannel(channel, cfg);
    const state = await fy.getChannelState(channel);
    print(state, values["json"] as boolean | undefined, () => formatChannel(state));
  });
}

const SWEEP_OBJECTS: Record<string, SweepObject> = {
  freq: SweepObject.Frequency,
  amp: SweepObject.Amplitude,
  offset: SweepObject.Offset,
  duty: SweepObject.DutyCycle,
};

async function cmdSweep(values: ParsedCli["values"]): Promise<void> {
  await withDevice(values, async (fy) => {
    if (values["stop"]) {
      await fy.stopSweep();
      console.log("Sweep stopped.");
      return;
    }
    const objectKey = String(values["object"] ?? "");
    const object = SWEEP_OBJECTS[objectKey];
    if (object === undefined) {
      throw new FeelTechError("--object must be one of: freq, amp, offset, duty");
    }
    await fy.configureSweep({
      object,
      start: parseNumber("start", values["start"]),
      end: parseNumber("end", values["end"]),
      timeSeconds: parseNumber("time", values["time"]),
      mode: values["log"] ? SweepMode.Logarithmic : SweepMode.Linear,
    });
    await fy.startSweep();
    console.log("Sweep started — stop with `feeltech sweep --stop`.");
  });
}

const GATE_TIMES: Record<string, GateTime> = {
  "1": GateTime.OneSecond,
  "10": GateTime.TenSeconds,
  "100": GateTime.HundredSeconds,
};

async function cmdMeasure(values: ParsedCli["values"]): Promise<void> {
  await withDevice(values, async (fy) => {
    if (values["gate"] !== undefined) {
      const gate = GATE_TIMES[String(values["gate"])];
      if (gate === undefined) throw new FeelTechError("--gate must be 1, 10 or 100");
      await fy.setGateTime(gate);
    }
    const m = await fy.readMeasurement();
    print(m, values["json"] as boolean | undefined, () =>
      [
        `Frequency: ${m.frequencyHz} Hz`,
        `Count:     ${m.count}`,
        `Period:    ${m.periodNs} ns`,
        `Pulse +:   ${m.positivePulseNs} ns`,
        `Pulse −:   ${m.negativePulseNs} ns`,
        `Duty:      ${m.dutyCyclePct}%`,
      ].join("\n"),
    );
  });
}

async function cmdWaveforms(values: ParsedCli["values"]): Promise<void> {
  const channel = parseChannel(values["channel"]);
  const json = values["json"] as boolean | undefined;
  const render = (family: DeviceFamily): void => {
    const list = listWaveforms(family, channel).filter((w) => !w.arbitrary);
    print(list, json, () =>
      list.map((w) => `${String(w.code).padStart(2, "0")}  ${w.name}`).join("\n"),
    );
  };
  if (values["family"]) {
    render(String(values["family"]) as DeviceFamily);
    return;
  }
  await withDevice(values, async (fy) => render(fy.family));
}

/** Parse waveform sample data: JSON array or one value per line. */
export function parseWaveformFile(content: string): number[] {
  const trimmed = content.trim();
  const values = trimmed.startsWith("[")
    ? (JSON.parse(trimmed) as number[])
    : trimmed
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"))
        .map(Number);
  if (!Array.isArray(values) || values.length === 0 || values.some((v) => !Number.isFinite(v))) {
    throw new FeelTechError("waveform file must contain a JSON array or one finite number per line");
  }
  return values;
}

async function cmdUpload(values: ParsedCli["values"]): Promise<void> {
  const slot = parseNumber("slot", values["slot"]);
  const file = values["file"];
  if (typeof file !== "string") throw new FeelTechError("--file is required");
  let samples = parseWaveformFile(readFileSync(file, "utf-8"));
  if (values["normalize"]) samples = normalizeWaveform(samples);
  if (values["resample"]) samples = resampleWaveform(samples, 8192);
  await withDevice(values, async (fy) => {
    console.log(`Uploading ${samples.length} samples to slot ${slot}…`);
    await fy.uploadWaveform(slot, samples);
    console.log(`Done — select it with: feeltech set --waveform Arbitrary${slot} --on`);
  });
}

const COMMANDS: Record<string, (values: ParsedCli["values"]) => Promise<void>> = {
  list: cmdList,
  info: cmdInfo,
  set: cmdSet,
  sweep: cmdSweep,
  measure: cmdMeasure,
  waveforms: cmdWaveforms,
  upload: cmdUpload,
};

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let parsed: ParsedCli;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
    return;
  }
  if (parsed.command === "help") {
    console.log(USAGE);
    return;
  }
  try {
    await COMMANDS[parsed.command]!(parsed.values);
  } catch (err) {
    console.error(err instanceof FeelTechError ? err.message : err);
    process.exitCode = 1;
  }
}

// Run only when executed directly (node dist/cli.js / npm bin shim), not when imported.
const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? "")).href;
  } catch {
    return false;
  }
})();
if (isMain) {
  await main();
}
