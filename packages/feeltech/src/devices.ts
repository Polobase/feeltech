/**
 * Registry descriptors for the FeelTech drivers.
 *
 * One entry per protocol family rather than per model: the wire format is what
 * a driver implements, and `FeelTech` auto-detects the exact model from `UMO`
 * once connected. The `auto` entry is the one to prefer — it lets the device
 * identify itself.
 */

import type { DeviceDescriptor, Transport } from "@freqgen/core";

import { FeelTech } from "./feeltech.js";
import { FY3200S, type FY3200SOptions } from "./fy3200s.js";
import type { FeelTechOptions } from "./types.js";

export const FEELTECH_DEVICES: readonly DeviceDescriptor[] = [
  {
    id: "auto",
    vendor: "FeelTech",
    label: "FY-series (auto-detect)",
    verified: "partial",
    note:
      "Protocol verified against an FY6300-60M. Frequency limits are read from " +
      "the model string the device reports; square and arbitrary bandwidth are " +
      "undocumented and stay unknown.",
    create: (transport: Transport, options?: Record<string, unknown>) =>
      new FeelTech(transport, options as FeelTechOptions),
  },
  {
    id: "fy6900",
    vendor: "FeelTech",
    label: "FY6300 / FY6600 / FY6800 / FY6900 / FY8300",
    verified: "partial",
    note: "115200 8N2, decimal-Hz frequency encoding. Verified on an FY6300-60M.",
    create: (transport: Transport, options?: Record<string, unknown>) =>
      new FeelTech(transport, { ...(options as FeelTechOptions), family: "FY6900" }),
  },
  {
    id: "fy3200s",
    vendor: "FeelTech",
    label: "FY3200S / FY3224S",
    verified: false,
    note:
      "The older FY dialect: 9600 8N1, b/d channel prefix, lowercase commands, " +
      "centihertz frequency, and no output relay (on/off is emulated by writing " +
      "the amplitude). Implemented from protocol documentation; not verified here.",
    create: (transport: Transport, options?: Record<string, unknown>) =>
      new FY3200S(transport, options as FY3200SOptions),
  },
  {
    id: "fy2300",
    vendor: "FeelTech",
    label: "FY2300 / FY2350",
    verified: false,
    note:
      "9600 8N1, integer-µHz frequency encoding. Implemented from the protocol " +
      "documentation; not verified against hardware here.",
    create: (transport: Transport, options?: Record<string, unknown>) =>
      new FeelTech(transport, { ...(options as FeelTechOptions), family: "FY2300" }),
  },
];
