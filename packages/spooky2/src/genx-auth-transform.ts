/**
 * Gen X Pro register-92 authentication response.
 *
 * The Pro gates its outputs behind a challenge/response handshake: the host
 * sends a nonce, the device returns two numbers, and the host must reply with a
 * value derived from them before any data register will accept writes. This
 * module computes that value, so the driver can talk to a Gen X Pro you own
 * without the vendor's software.
 *
 * ## Provenance and purpose
 *
 * The transform is an interoperability key for the device, not a lock on any
 * copyrighted content — a small arithmetic function, reimplemented here from its
 * description (the Spooky2 application's `Proc_0_356` response routine, as
 * recovered by the Resona project). It is included so owners of the hardware can
 * drive it from this library; it grants no access to anything but the buyer's
 * own generator.
 *
 * Verified end-to-end against a real Gen X Pro (firmware 200): the computed
 * response unlocks the device and the outputs then drive.
 *
 * ## The algorithm
 *
 *   out[k] = ((v2[b]·v2[c] + v2[a]·v2[nonce[k]]) mod 9) + 1,   k = 0..8
 *
 * where `v2` is the second challenge value, `nonce[k]` selects an index into
 * `v2` (so a digit of the nonce chooses which digit of the challenge to fold in
 * — the "indirect" term), and `PAT[k]` fixes the `[a, b, c]` index triple for
 * each output digit. All indices are 1-based, VB `Val`-style: a non-digit reads
 * as 0. The nonce is a permutation of 1–9, which keeps every index in range.
 *
 * Self-check vector: nonce=516793428, v2=621534987 → 319652537.
 */

import type { AuthChallenge, AuthProvider } from "./auth.js";

/** Fixed index triples `[a, b, c]` per output digit. */
const PAT: ReadonlyArray<readonly [number, number, number]> = [
  [4, 6, 8],
  [6, 4, 1],
  [8, 6, 5],
  [3, 2, 9],
  [7, 8, 4],
  [3, 1, 7],
  [9, 4, 3],
  [1, 6, 2],
  [3, 2, 8],
];

/** 1-based digit read; non-digit → 0 (matches VB `Val`). */
function digitAt(s: string, oneBasedIndex: number): number {
  const ch = s.charCodeAt(oneBasedIndex - 1);
  return ch >= 48 && ch <= 57 ? ch - 48 : 0;
}

/**
 * Compute the register-92 response for a challenge.
 *
 * @returns the nine-digit response, or `null` if either input is too short.
 */
export function genXAuthResponse(nonce: string, v2: string): string | null {
  if (nonce.length < 9 || v2.length < 9) return null;
  let out = "";
  for (let k = 0; k < 9; k++) {
    const [a, b, c] = PAT[k]!;
    const va = digitAt(v2, a);
    const vb = digitAt(v2, b);
    const vc = digitAt(v2, c);
    const nonceDigit = digitAt(nonce, k + 1);
    const indirect = nonceDigit >= 1 && nonceDigit <= 9 ? digitAt(v2, nonceDigit) : 0;
    const value = vc * vb + va * indirect;
    out += String((value % 9) + 1);
  }
  return out;
}

/**
 * The bundled {@link AuthProvider} for the Gen X Pro.
 *
 * `GenXPro` uses this by default, so a Pro authenticates and its outputs drive
 * without any extra setup. Pass your own `authProvider` to override it.
 */
export const GENX_AUTH_PROVIDER: AuthProvider = {
  respond({ nonce, v2 }: AuthChallenge): string {
    const response = genXAuthResponse(nonce, v2);
    if (response === null) {
      throw new Error(
        `Gen X Pro challenge too short (nonce=${nonce.length}, v2=${v2.length} digits)`,
      );
    }
    return response;
  },
};
