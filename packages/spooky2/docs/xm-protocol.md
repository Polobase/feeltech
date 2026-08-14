# Spooky2 XM serial protocol

**Verification status: unverified.** Everything here is derived from the
`calum74/s2` reimplementation of the Spooky2 generator link (`Generator.cpp`),
not from measurements on an XM. The driver's wire-transcript tests assert
conformance to this document; they do not prove the document is right. Confirm
output with a scope before relying on it.

## Link

| Setting | Value |
| --- | --- |
| Baud rate | 57600 |
| Data bits | 8 |
| Parity | none |
| Stop bits | 1 |
| Flow control | none |
| USB bridge | CP210x (`10c4:ea60`) on the units described; others report CH340 |

## Framing

```
:w<register><value>\r\n     →     ok\r\n
```

`register` is two digits, `value` a decimal integer with no padding. Every
command is acknowledged with `ok`. Units in the field skip the acknowledgement
often enough that the driver treats a missing one as a warning rather than an
error; pass `strictAck: true` to reverse that.

## Registers

Per-channel registers are addressed by **adding the channel index to the base**,
so CH1 frequency is 23 and CH2 frequency is 24.

| Base | Parameter | Encoding |
| --- | --- | --- |
| 21 | Waveform | slot index |
| 23 | Frequency | integer counts, see ranging below |
| 25 | Amplitude | volts peak-to-peak × 100 (centivolts) |
| 27 | Offset | fraction of amplitude × 100, biased by 100 (`0` = −100 %, `100` = 0, `200` = +100 %) |
| 29 | Duty cycle | percent × 10 (0.1 % resolution) |
| 31 | Phase | degrees, 0–359 |
| 61 | Output relay | `0` / `1` |
| 63 | Frequency scale | `0` = coarse, `1` = fine |
| 68 | Sync (**not** per-channel) | `0` / `1`; slaves CH2's frequency to CH1 |

## Frequency ranging

The frequency register is a plain integer, so the firmware trades range against
resolution and uses register 63 to say which reading applies:

| Range | Condition | Scale register | Count size | Example |
| --- | --- | --- | --- | --- |
| Coarse | `hz ≥ 600` | `0` | 10 mHz | 727.5 Hz → `72750` |
| Fine | `hz < 600` | `1` | 10 µHz | 440 Hz → `44000000` |

The driver caches the scale per channel and rewrites register 63 only when a
frequency crosses the boundary — rewriting it on every step would double the
traffic during a frequency run.

## Waveform slots

| Slot | Shape | Confidence |
| --- | --- | --- |
| 0 | Sine | corroborated |
| 1 | Square | corroborated |
| 2 | Sawtooth | slot confirmed, **direction not established** |
| 3 | User-defined | corroborated |

The driver claims slot 2 as `ramp-up`. Because the direction is unconfirmed, a
`ramp-down` request substitutes onto it and reports `substituted: true` rather
than pretending to be exact.

## Offset

The XM states offset as a fraction of amplitude, not as an absolute voltage.
`setOffsetRatio()` is the native unit and the one Spooky2 presets are written in
— "100 % offset" in a Spooky2 shell means ratio `+1`, a fully positive waveform.
`setOffset()` accepts volts and converts using the last amplitude written to the
channel, so set amplitude first when both change.
