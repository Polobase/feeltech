/**
 * Enums are modelled as `as const` objects with literal-union types instead of
 * TypeScript `enum`s: they behave identically at call sites (`Channel.Main`),
 * but keep the library consumable under `isolatedModules`, `erasableSyntaxOnly`
 * and Node's native type stripping, and stay tree-shakeable.
 */

/**
 * Channel identifiers. Channel 0 = main (CH1, "M" prefix in protocol).
 * Channel 1 = auxiliary / sub (CH2, "F" prefix in protocol).
 */
export const Channel = {
  Main: 0,
  Aux: 1,
} as const;
export type Channel = (typeof Channel)[keyof typeof Channel];

/** Modulation mode (FY6300/6600/6800/6900/8300). */
export const ModulationMode = {
  ASK: 0,
  FSK: 1,
  PSK: 2,
  Burst: 3,
  AM: 4,
  FM: 5,
  PM: 6,
} as const;
export type ModulationMode = (typeof ModulationMode)[keyof typeof ModulationMode];

/** Modulation source (FY63xx/68xx/69xx/83xx). */
export const ModulationSource = {
  CH2: 0,
  ExternalAC: 1,
  Manual: 2,
  ExternalDC: 3,
} as const;
export type ModulationSource = (typeof ModulationSource)[keyof typeof ModulationSource];

/** Sweep parameter target. */
export const SweepObject = {
  Frequency: 0,
  Amplitude: 1,
  Offset: 2,
  DutyCycle: 3,
} as const;
export type SweepObject = (typeof SweepObject)[keyof typeof SweepObject];

/** Sweep mode. */
export const SweepMode = {
  Linear: 0,
  Logarithmic: 1,
} as const;
export type SweepMode = (typeof SweepMode)[keyof typeof SweepMode];

/** Sweep control source. */
export const SweepSource = {
  Time: 0,
  VCO: 1,
} as const;
export type SweepSource = (typeof SweepSource)[keyof typeof SweepSource];

/** Counter / measurement gate time. */
export const GateTime = {
  OneSecond: 0,
  TenSeconds: 1,
  HundredSeconds: 2,
} as const;
export type GateTime = (typeof GateTime)[keyof typeof GateTime];

/** Measurement input coupling. */
export const CouplingMode = {
  DC: 0,
  AC: 1,
} as const;
export type CouplingMode = (typeof CouplingMode)[keyof typeof CouplingMode];

/** Channel attenuation. */
export const Attenuation = {
  Zero: 0,
  Minus20dB: 1,
} as const;
export type Attenuation = (typeof Attenuation)[keyof typeof Attenuation];

/** Synchronization parameter. */
export const SyncObject = {
  Waveform: 0,
  Frequency: 1,
  Amplitude: 2,
  Offset: 3,
  DutyCycle: 4,
} as const;
export type SyncObject = (typeof SyncObject)[keyof typeof SyncObject];

/** Cascade role. */
export const CascadeRole = {
  Master: 0,
  Slave: 1,
} as const;
export type CascadeRole = (typeof CascadeRole)[keyof typeof CascadeRole];

/**
 * Device family. Determines protocol details (baud rate, encoding, waveform table).
 */
export type DeviceFamily =
  /** FY2300 series. 9600 baud, integer µHz frequency. */
  | "FY2300"
  /** FY6300/6600/6800/6900/8300. 115200 baud, decimal Hz frequency. */
  | "FY6900"
  | "Unknown";

/**
 * Wire encoding for the WMF/WFF frequency value.
 * - `"uHz"`: 14-digit µHz integer (FY2300 default; also required by some older
 *   FY6900 firmware revisions).
 * - `"hz"`: decimal Hz, `%015.6f` (FY6900-family default).
 */
export type FrequencyEncoding = "hz" | "uHz";

/** Connection options for the FeelTech device. */
export interface FeelTechOptions {
  /**
   * Override the auto-detected device family. By default the library queries
   * `UMO` and decides based on the response.
   */
  family?: DeviceFamily;
  /** Serial baud rate. Defaults to family-specific value (9600 for FY2300, 115200 otherwise). */
  baudRate?: number;
  /**
   * Override the frequency wire encoding. Defaults to the family-specific
   * encoding; set to `"uHz"` if an FY6900-family device with old firmware
   * sets frequencies off by a factor of 10⁶.
   */
  frequencyEncoding?: FrequencyEncoding;
  /** Read timeout in ms. Default: 1500. */
  readTimeoutMs?: number;
  /** Number of retries for read commands. Default: 2. */
  readRetries?: number;
  /** Inter-command delay in ms (some firmwares need a pause). Default: 0. */
  commandDelayMs?: number;
  /** Enable verbose logging of all sent/received bytes. */
  debug?: boolean;
  /** Optional logger. Defaults to console.log when debug=true. */
  logger?: (message: string, ...args: unknown[]) => void;
}

/** Snapshot of a single channel's state. */
export interface ChannelState {
  waveform: number;
  waveformName?: string;
  frequencyHz: number;
  amplitudeV: number;
  offsetV: number;
  dutyCyclePct: number;
  phaseDeg: number;
  enabled: boolean;
}

/** Result of a counter/measurement query. */
export interface MeasurementResult {
  /** Frequency in Hz, scaled by gate time. */
  frequencyHz: number;
  /** Pulse count. */
  count: number;
  /** Period in nanoseconds. */
  periodNs: number;
  /** Positive pulse width in nanoseconds. */
  positivePulseNs: number;
  /** Negative pulse width in nanoseconds. */
  negativePulseNs: number;
  /** Duty cycle percentage. */
  dutyCyclePct: number;
  /** Current gate time setting. */
  gateTime: GateTime;
}

/** Sweep configuration. */
export interface SweepConfig {
  object: SweepObject;
  start: number;
  end: number;
  timeSeconds: number;
  mode: SweepMode;
  source?: SweepSource;
}

/** Waveform descriptor returned by `listWaveforms()`. */
export interface WaveformDescriptor {
  code: number;
  name: string;
  arbitrary?: boolean;
  /** Slot index for arbitrary waveforms (1-based). */
  arbitrarySlot?: number;
}

/** Errors thrown by this library. */
export class FeelTechError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "FeelTechError";
    if (cause !== undefined) this.cause = cause;
  }
}

export class FeelTechTimeoutError extends FeelTechError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "FeelTechTimeoutError";
  }
}

export class FeelTechProtocolError extends FeelTechError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "FeelTechProtocolError";
  }
}
