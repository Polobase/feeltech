/**
 * What a given generator can actually do.
 *
 * Capabilities exist so callers can adapt *before* sending a command that would
 * be silently ignored. Every flag here comes from a real difference between
 * supported devices, not from speculation:
 *
 * - `outputRelay: false`  — FY3200S-class devices have no output relay; a driver
 *                           gates output by writing 0 V instead.
 * - `perChannelOutput: false` — the MHS-5200A's output switch is device-global.
 * - `dutyGatedByWaveform` — the FY6900 ignores duty on waveform index 1
 *                           (Square, fixed 50 %); duty only applies to index 2
 *                           (Rectangle).
 * - `requiresFrequencyRamp` — the Gen X produces no output if you jump straight
 *                           to a target frequency; it must be ramped.
 * - `requiresAuth`        — the Gen X Pro gates physical output behind a
 *                           challenge/response handshake.
 */

import type { FrequencyLimits } from "./limits.js";
import type { WaveformKind } from "./device.js";

export interface Capabilities {
  /** Number of independently addressable output channels. */
  channels: number;
  /** Output can be switched per channel (false ⇒ one switch for the whole device). */
  perChannelOutput: boolean;
  /** Device has a real output relay (false ⇒ driver emulates on/off via amplitude). */
  outputRelay: boolean;
  /** Device can slave CH2's frequency to CH1 in hardware. */
  hardwareSync: boolean;
  /** Duty cycle only takes effect on certain waveforms (see FY6900 note above). */
  dutyGatedByWaveform: boolean;
  /** Physical output requires a successful auth handshake. */
  requiresAuth: boolean;
  /** Frequency must be approached in steps, not set in one write. */
  requiresFrequencyRamp: boolean;
  /** Parameters the device can read back, enabling verified writes. */
  readback: boolean;
  /** Generic waveform kinds this device can produce natively. */
  waveforms: readonly WaveformKind[];
  /** Frequency limits and how well established they are. */
  limits: FrequencyLimits;
}

/**
 * Sensible defaults for a plain two-channel generator with a real output relay.
 * Drivers spread this and override only what differs, so a new capability flag
 * doesn't require touching every driver.
 */
export const DEFAULT_CAPABILITIES: Omit<Capabilities, "waveforms" | "limits"> = {
  channels: 2,
  perChannelOutput: true,
  outputRelay: true,
  hardwareSync: false,
  dutyGatedByWaveform: false,
  requiresAuth: false,
  requiresFrequencyRamp: false,
  readback: false,
};
