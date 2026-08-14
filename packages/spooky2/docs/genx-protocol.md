# Spooky2 Gen X serial protocol

**The authoritative register map is now
[`spooky2-command-set.md`](spooky2-command-set.md)**, extracted from the vendor
application's own debug labels and cross-checked on hardware. This file records
what was confirmed against a real unit and how the earlier map was corrected.

## Confirmed against a real Gen X Pro (firmware 200)

- Link settings and framing (below).
- Both generators enumerate through **one CH34x bridge** (`1a86:55d2`) as two
  interfaces sharing a serial number and USB location.
- Each unit self-reports its identity on `:r01=` (`G1` / `G2`), and that
  identity **does not** follow port ordering — channel mapping must use the
  reported identity, not connection order.
- The lock: while locked, every register except `:r90`/`:r92` answers `:err`.
  `:r90=<nonce>,` returns two 9-digit challenge values, fresh per call and
  different per unit; a wrong `:w92=` answers `:err` in ~3 ms.
- **The auth handshake works** — with a valid `:w92` response the registers
  unlock and the output can be driven.
- **`:w28` is amplitude.** With the output running, stepping `:w28` moves the
  device's biofeedback current sensor (`:r11`) monotonically; stepping `:w17`
  does not. That confirms the vendor's amplitude assignment and refutes the
  third-party one (which had `:w17` as amplitude and `:w28` as a ramp target).

## How the earlier map was wrong

The first version of this driver came from third-party reverse engineering and
had, among others, `:w24` as an exponent-encoded "arm" register, `:w28`/`:w29`
as display-frequency ramp targets, and `:w17` as amplitude. Under that reading a
plain frequency write appeared to produce no output, which led to a
prepare → arm → **ramp** → amplitude sequence.

The vendor labels — and the hardware — show `:w28`/`:w29` are **amplitude**. The
"ramp" was stepping the amplitude up from zero; that is why output seemed to
"appear" partway through. The Gen X needs no ramp and drives like any register
device. The `capabilities.requiresFrequencyRamp` flag is now `false`.

## Link

| Setting | Value |
| --- | --- |
| Baud rate | 115200 |
| Data bits / parity / stop bits | 8 / none / 1 |
| USB bridge | CH34x (`1a86:55d2`) on this unit — **two ports, one per generator** |

Do not toggle DTR/RTS on open: on a dual-port bridge that resets the sibling
port's display.

## Framing

```
write:  :w<reg>=<field0>,<field1>,\r\n   →   :ok  /  :err
read:   :r<reg>=\r\n                     →   :r<reg>=<v>   /   :err
```

Registers take two comma-separated fields, one per output. Addressing one output
fills its field and leaves the other empty (`:w28=5,,` / `:w28=,5,`). Each write
must be answered before the next is sent — the device drops commands that arrive
while it is still replying.

There is **no live-parameter readback**: the `:r*` space is offline-program
memory (zero until a program is loaded) and the two analog biofeedback readings
(`:r11` current, `:r12` angle), not a mirror of the write registers.

## Scale factors — still unmeasured

The register *assignments* are settled; their *encodings* are not. The driver
uses XM-analogous defaults — frequency Hz×100 (or ×100000 in low-frequency mode,
below 600 Hz), amplitude in centivolts, offset centred on 120 — and marks them
in code as needing scope confirmation.

## Authentication

`:r90=<nonce>,` → two challenge values → `:w92=<response>.` → `:ok`. The host
nonce is a random permutation of the digits 1–9; two rounds are required. The
response transform is **not** shipped in this package — see `../src/auth.ts` and
the `AuthProvider` hook.
