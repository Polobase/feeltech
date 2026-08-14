/**
 * `@freqgen/core` — the parts every arbitrary waveform generator driver
 * shares: serial transports, the {@link SignalGenerator} contract, capability
 * and frequency-limit metadata, and octave folding.
 *
 * Vendor packages (`feeltech`, `@freqgen/spooky2`) depend on this and add the
 * protocol. Application code normally imports the vendor package, and reaches
 * for this one when it wants to treat several generators interchangeably.
 */

export {
  AwgError,
  AwgTimeoutError,
  AwgProtocolError,
  AwgVerifyError,
} from "./errors.js";

export { LineBuffer, encodeText, readReply } from "./transport.js";
export type { Transport, SerialOpenOptions } from "./transport.js";

export {
  applyStepSequentially,
  substituteWaveform,
} from "./device.js";
export type {
  SignalGenerator,
  DeviceInfo,
  ChannelStep,
  WaveformKind,
  AppliedWaveform,
} from "./device.js";

export { DeviceRegistry } from "./registry.js";
export type { DeviceDescriptor } from "./registry.js";

export { DEFAULT_CAPABILITIES } from "./capabilities.js";
export type { Capabilities } from "./capabilities.js";

export { resolveCap, unknownLimits } from "./limits.js";
export type {
  FrequencyLimits,
  FrequencyRange,
  LimitOverride,
  ResolvedCap,
  VerificationLevel,
  WaveformClass,
} from "./limits.js";

export { foldToBand, fitFrequencies } from "./octave.js";
export type {
  Band,
  FoldResult,
  FitOptions,
  FitResult,
  FitStatus,
  FitWarning,
} from "./octave.js";

export {
  USB_SERIAL_BRIDGES,
  USB_SERIAL_FILTERS,
  USB_SERIAL_VENDOR_IDS,
  describeBridge,
} from "./usb.js";
export type { UsbBridge } from "./usb.js";
