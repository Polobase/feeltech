/**
 * Gen X wire encodings shared by the classic and Pro drivers.
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
 * Amplitude in centivolts.
 *
 * The scale factor is mirrored from the Spooky2 XM and is not scope-confirmed on
 * the Gen X — the register *assignment* is confirmed, its counts-per-volt is
 * not. See the Gen X Pro driver's header note.
 */
export function amplitudeRegisterValue(volts: number): number {
  return Math.round(Math.max(0, volts) * 100);
}
