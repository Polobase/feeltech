/**
 * Gen X wire encodings, shared by the classic and Pro drivers.
 *
 * **Verification status: unverified.** These encodings come from third-party
 * reverse engineering of the Spooky2 application, not from measurements here.
 * They are reproduced as protocol facts — register numbers and scale factors —
 * and every one is exercised by wire-transcript tests so a future correction
 * shows up as a failing assertion rather than a silent behaviour change.
 */

/**
 * Per-channel comma-slot syntax.
 *
 * Gen X registers take two comma-separated fields, one per output. Addressing a
 * single channel means filling its field and leaving the other empty:
 * channel 0 is `<v>,,` and channel 1 is `,<v>,`.
 */
export function channelSlot(channel: number, value: number | string): string {
  return channel === 1 ? `,${value},` : `${value},,`;
}

/**
 * Frequency encoding for the arm register (24).
 *
 * The register packs a mantissa and a decimal exponent into one integer: the
 * last digit is the exponent code `8 - p`, where `p` is how many decimal places
 * the mantissa needed, and the leading digits are the mantissa. Reading it back
 * out, the display value is `floor(v / 10) × 10^((v mod 10) - 8)`.
 *
 * ```
 *    64 Hz → p=0, M=64    → 648
 *   440 Hz → p=0, M=440   → 4408
 * 727.5 Hz → p=1, M=7275  → 72757
 * ```
 */
export function armRegisterValue(hz: number): number {
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

/**
 * Frequency encoding for the display registers (28 and 29).
 *
 * Unlike the arm register these carry no exponent, so the scale is inferred
 * from how much precision the value needs: whole hertz go in as-is, two decimal
 * places as centihertz, anything finer as hundred-thousandths.
 */
export function displayRegisterValue(hz: number): number {
  if (Number.isInteger(hz)) return hz;
  const centi = hz * 100;
  if (Math.abs(centi - Math.round(centi)) < 1e-6) return Math.round(centi);
  return Math.round(hz * 100_000);
}

/** Amplitude in centivolts, the unit registers 17 and 25 take. */
export function amplitudeRegisterValue(volts: number): number {
  return Math.round(Math.max(0, volts) * 100);
}
