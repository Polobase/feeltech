/**
 * Gen X wire encodings shared by the classic and Pro drivers.
 */

/**
 * Two-field, per-output slot syntax, for registers that carry **both** outputs
 * in one write (output enable `:w11`, waveform inversion `:w17`).
 *
 * Channel 0 fills the first field (`<v>,,`), channel 1 the second (`,<v>,`).
 * Most Gen X registers are *not* like this — each output has its own register
 * and takes a single field-1 value; see {@link outField}.
 */
export function channelSlot(channel: number, value: number | string): string {
  return channel === 1 ? `,${value},` : `${value},,`;
}

/**
 * Single-field value for an output-specific register (`:w24=<v>,`).
 *
 * Confirmed on hardware: the per-output registers (frequency 24/25, amplitude
 * 28/29, offset 32/33, waveform 20/21, …) read the value from field 1
 * regardless of which output they belong to. Writing an Out 2 value into the
 * second field — as an earlier version did — left Out 2 unset.
 */
export function outField(value: number | string): string {
  return `${value},`;
}

/**
 * Encode a frequency for the Gen X frequency register (24/25).
 *
 * The register packs a mantissa and a decimal exponent into one integer: the
 * last digit is the exponent code `8 − p`, where `p` is how many decimal places
 * the mantissa needed. The device decodes it as
 * `floor(v / 10) × 10^((v mod 10) − 8)`.
 *
 * Confirmed against a real Gen X Pro by reading the device display:
 * ```
 *    1000 Hz → p=0, mantissa 1000  → 10008   (display 1000.00000000 Hz)
 *   727.5 Hz → p=1, mantissa 7275  → 72757   (display  727.50000000 Hz)
 * ```
 *
 * The eight-place exponent range spans ~1e-8 Hz to ~1e8 Hz, so it covers the
 * whole device range without a separate scale mode (the driver keeps the
 * low-frequency-mode registers at 0, where this encoding decodes directly).
 */
export function encodeGenXFrequency(hz: number): number {
  const value = Math.max(0, hz);
  let places = 0;
  while (
    places < 8 &&
    Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) > 1e-9
  ) {
    places += 1;
  }
  const mantissa = Math.round(value * 10 ** places);
  return mantissa * 10 + (8 - places);
}

/** Decode a Gen X frequency register value back to hertz (inverse of the above). */
export function decodeGenXFrequency(v: number): number {
  const exponentCode = v % 10;
  const mantissa = Math.floor(v / 10);
  return mantissa * 10 ** (exponentCode - 8);
}

/**
 * Amplitude register value for a peak-to-peak voltage.
 *
 * The register stores centivolts of *peak* amplitude, so a peak-to-peak input
 * is halved: `vpp / 2 × 100 = vpp × 50`. Confirmed from a Spooky2 capture,
 * where a `20` (20 Vpp) preset drove the live register `:w28=1000,` — half of
 * the offline `:p` amplitude field (`2000`, which stores peak-to-peak
 * centivolts). This also matches the published "20 Vpp max / 0.01 V
 * resolution" spec: 0–1000 counts cover 0–10 V peak (0.01 V per count).
 */
export function amplitudeRegisterValue(vpp: number): number {
  return Math.round(Math.max(0, vpp) * 50);
}
