/**
 * Gen X Pro authentication.
 *
 * The Pro gates **physical output** behind a challenge/response handshake on
 * register 92: the host sends a nonce to register 90, the device answers with
 * two numbers, and the host must write back a value derived from them. Until
 * that succeeds, registers can be written and read but the outputs stay dead.
 *
 * ## Why no algorithm ships here
 *
 * The transform that turns the challenge into the response is not published.
 * The implementations in circulation were recovered by disassembling the vendor
 * application, and the lock exists specifically to keep third-party software
 * from driving the outputs. Running such a transform on hardware you own is one
 * thing; distributing it inside an npm package is a different question, and not
 * one this library answers on its users' behalf.
 *
 * So the handshake is implemented and the transform is left as a hole you fill:
 *
 * ```ts
 * const pro = new GenXPro(transport, {
 *   authProvider: {
 *     respond(nonce, challenge) {
 *       return myTransform(nonce, challenge);
 *     },
 *   },
 * });
 * ```
 *
 * Without a provider the driver still connects, configures and reads back
 * normally; `authenticated` stays `false` and it warns that output is gated.
 */

export interface AuthChallenge {
  /** The nonce this host sent to register 90. */
  nonce: string;
  /** First value the device returned. */
  v1: string;
  /** Second value the device returned — the one implementations key on. */
  v2: string;
}

export interface AuthProvider {
  /**
   * Produce the value to write to register 92 for this challenge.
   *
   * Return the digits only, with no `:w92=` prefix or trailing punctuation.
   */
  respond(challenge: AuthChallenge): string | Promise<string>;
}

/**
 * Generate a host nonce: a random permutation of the digits 1–9.
 *
 * Zero is excluded deliberately. The known response transforms index into the
 * nonce digit by digit, and a zero digit would collapse those lookups.
 */
export function generateNonce(random: () => number = Math.random): string {
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = digits[i]!;
    digits[i] = digits[j]!;
    digits[j] = a;
  }
  return digits.join("");
}
