/**
 * Registry descriptors for the Spooky2 drivers.
 *
 * Every entry reports `verified: false` — none of these has been checked
 * against hardware. The `note` says what specifically is unestablished, so a
 * user interface can show more than a bare warning triangle.
 */

import type { DeviceDescriptor, Transport } from "@freqgen/core";

import { GenXClassic, type GenXClassicOptions } from "./genx-classic.js";
import { GenXPro, type GenXProOptions } from "./genx-pro.js";
import { Spooky2XM, type Spooky2XmOptions } from "./xm.js";

export const SPOOKY2_DEVICES: readonly DeviceDescriptor[] = [
  {
    id: "xm",
    vendor: "Spooky2",
    label: "XM",
    verified: false,
    note:
      "Register map from the calum74/s2 reimplementation. Sawtooth slot direction " +
      "unconfirmed; no frequency limits established.",
    create: (transport: Transport, options?: Record<string, unknown>) =>
      new Spooky2XM(transport, options as Spooky2XmOptions),
  },
  {
    id: "genx",
    vendor: "Spooky2",
    label: "Gen X (classic)",
    verified: false,
    note:
      "Experimental. Register map from third-party non-Pro notes; the audio/RF " +
      "range boundary is a default, not a measurement. No offset, duty or phase.",
    create: (transport: Transport, options?: Record<string, unknown>) =>
      new GenXClassic(transport, options as GenXClassicOptions),
  },
  {
    id: "genx-pro",
    vendor: "Spooky2",
    label: "Gen X Pro",
    verified: false,
    note:
      "Register map from the vendor application, amplitude assignment confirmed " +
      "on a real unit (firmware 200) via the biofeedback sensor; scale factors " +
      "not yet scope-confirmed. Physical output is gated behind a register-92 " +
      "handshake and no response algorithm ships here — supply an AuthProvider.",
    create: (transport: Transport, options?: Record<string, unknown>) =>
      new GenXPro(transport, options as GenXProOptions),
  },
];
