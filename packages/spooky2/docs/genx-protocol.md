# Spooky2 Gen X serial protocol

**Verification status: unverified.** Everything here comes from third-party
reverse engineering of the Spooky2 application, not from measurements. The
driver's wire-transcript tests assert conformance to this document; they do not
prove the document is right. Confirm output with a scope.

## Link

| Setting | Value |
| --- | --- |
| Baud rate | 115200 |
| Data bits / parity / stop bits | 8 / none / 1 |
| USB bridge | CP2105 on the Pro — **two ports per unit**, each an independent generator |

Do not toggle DTR/RTS on open: on a dual-port bridge that resets the sibling
port's display.

## Framing

```
write:  :w<reg>=<field0>,<field1>,\r\n   →   :ok  /  :err
read:   :r<reg>=\r\n                     →   :r<reg>=<v1>,<v2>
```

Registers take two comma-separated fields, one per output. Addressing a single
channel means filling its field and leaving the other empty — channel 0 is
`<v>,,` and channel 1 is `,<v>,`.

Each write must be answered before the next is sent. The device drops commands
that arrive while it is still replying.

## Registers

| Register | Purpose |
| --- | --- |
| 11 | Output arm mask (both fields: Out1, Out2) |
| 12 | Reset — written as the pair `:w12=0,,` then `:w12=,0,` |
| 13 | Clear |
| 14 | Channel select (`1` or `2`) |
| 15 | Frequency range toggle (classic unit) |
| 17 | Amplitude, centivolts, both outputs |
| 20 / 21 | DDS path select |
| 22 | Waveform slot |
| 24 | Arm frequency — see encoding below |
| 28 / 29 | Display frequency |
| 32 / 33 | DC offset (`120` = neutral) — **see the warning below** |
| 40 | Stop |
| 90 | Auth challenge |
| 92 | Auth response / lock status |

## Frequency encodings

### Arm register (24)

Packs a mantissa and a decimal exponent into one integer. The last digit is the
exponent code `8 - p`, where `p` is the number of decimal places the mantissa
needed; the leading digits are the mantissa.

| Frequency | Places `p` | Mantissa | Register |
| --- | --- | --- | --- |
| 64 Hz | 0 | 64 | `648` |
| 440 Hz | 0 | 440 | `4408` |
| 727.5 Hz | 1 | 7275 | `72757` |

Decoding: `display = floor(v / 10) × 10^((v mod 10) − 8)`.

### Display registers (28, 29)

No exponent; the scale is inferred from the precision needed — whole hertz
as-is, two decimal places as centihertz, anything finer as hundred-thousandths.

## The step sequence

A bare frequency write produces **no output**. The Pro needs the full sequence:

1. **Display text** — `:n00=<text>`. Acts as an output gate, not just an LCD write.
2. **Prepare channel** (once per channel) — stop state, register 12 resets, DDS
   path selection, `:w14=<channel+1>`.
3. **Arm** — `:w13=0,` → DDS select → `:w24=<arm value>,` → register 12 reset →
   `:w21=25,` → `:w11=<mask>`.
4. **Ramp** — step registers 28 and 29 up to the target. A single jump leaves the
   output silent. The walk uses 50 Hz increments, switching to even division
   above 24 intermediate steps so any target is reached in about a second.
5. **Amplitude** — `:w17=<cv>,<cv>,`.

Stopping must disarm register 11 **first**, otherwise the output sticks at
whatever frequency register 24 last held.

## ⚠ DC offset

Registers 32 and 33 do carry the offset (`70` ≈ −100 %, `120` = neutral, linear
between). But the only known way to latch them is inside the stop sequence,
where `:w40=0,` follows each write — and `:w40=0,` is a **stop command, not a
latch**. Writing the offset registers outside that sequence has been observed to
silence the output entirely.

The driver therefore refuses any offset other than 0 V rather than issuing a
write that would quietly kill the channel.

## Authentication

Physical output is gated behind a challenge/response handshake:

```
:r92=            → lock status (0 = locked)
:r90=<nonce>,    → two challenge values
:w92=<response>. → unlock
```

The host nonce is a random permutation of the digits 1–9; zero is excluded
because the known transforms index into the nonce digit by digit. Two rounds are
required — one successful exchange has been observed not to unlock on its own.

**This package ships no response algorithm.** The transform is not published,
the implementations in circulation were recovered by disassembling the vendor
application, and the lock exists precisely to keep third-party software from
driving the outputs. Supply an `AuthProvider` if you want to unlock your own
hardware; see `src/auth.ts`.

Without a provider the driver connects, writes and reads registers normally, and
reports `authenticated === false`.
