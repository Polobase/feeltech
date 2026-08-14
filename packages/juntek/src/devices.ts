/**
 * Registry descriptors for the JUNTEK / Koolertron drivers.
 *
 * Five of the six entries share one driver: the JDS register protocol is the
 * same across the JDS line, and the Koolertron CJDS66 is a rebadged JDS6600.
 * They are listed separately anyway so a user picking their device by name gets
 * the right label and the right caveats.
 */

import type { DeviceDescriptor, Transport } from "@freqgen/core";

import { Jds6600, type JdsModel, type Jds6600Options } from "./jds6600.js";
import { Mhs5200a, type Mhs5200aOptions } from "./mhs5200a.js";

function jds(
  id: string,
  model: JdsModel,
  vendor: string,
  note: string,
): DeviceDescriptor {
  return {
    id,
    vendor,
    label: model,
    verified: false,
    note,
    create: (transport: Transport, options?: Record<string, unknown>) =>
      new Jds6600(transport, { ...(options as Jds6600Options), model }),
  };
}

const JDS_NOTE =
  "JDS register protocol from on1arf/jds6600_python and the Joy-IT manual. " +
  "Waveform slot 3 is a triangle, not a sawtooth. No frequency limits established.";

export const JUNTEK_DEVICES: readonly DeviceDescriptor[] = [
  jds("jds6600", "JDS6600", "JUNTEK", JDS_NOTE),
  jds("jds2800", "JDS2800", "JUNTEK", JDS_NOTE),
  jds("jds2900", "JDS2900", "JUNTEK", JDS_NOTE),
  jds(
    "jds8000",
    "JDS8000",
    "JUNTEK",
    JDS_NOTE + " The JDS8000 is reported to use this protocol but is the least corroborated of the set.",
  ),
  jds(
    "cjds66",
    "CJDS66",
    "Koolertron",
    "Rebadged JDS6600 — Koolertron resells JUNTEK hardware. " + JDS_NOTE,
  ),
  {
    id: "mhs5200a",
    vendor: "Koolertron",
    label: "MHS-5200A",
    verified: false,
    note:
      "MHINSTEK/JUNTEK hardware sold as Koolertron. Output on/off is device-global, " +
      "not per channel — a muted channel is silenced by writing 0 V. The attenuator " +
      "is pinned to 0 dB on connect so amplitude means volts.",
    create: (transport: Transport, options?: Record<string, unknown>) =>
      new Mhs5200a(transport, options as Mhs5200aOptions),
  },
];
