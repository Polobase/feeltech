# JUNTEK JDS6600 serial protocol

Covers the JDS6600, JDS2800, JDS2900, JDS8000 and the Koolertron-badged CJDS66 —
one protocol, several labels. Koolertron is a reseller rather than a
manufacturer; the CJDS66 is a rebadged JDS6600.

**Verification status: unverified.** Derived from `on1arf/jds6600_python` and the
Joy-IT JDS6600 protocol manual, not from measurements. The JDS8000 is reported to
use this protocol but is the least corroborated of the set.

## Link

| Setting | Value |
| --- | --- |
| Baud rate | 115200 |
| Data bits / parity / stop bits | 8 / none / 1 |
| USB bridge | CH340 (`1a86:7523`) |

## Framing

```
:w<register>=<value>.\r\n     →     :ok
```

The trailing `.` is part of the command, not punctuation.

## Registers

Per-channel registers take the channel index added to the base — CH1 frequency
is 23, CH2 frequency is 24. **Register 20 is the exception**: it carries both
channels' output states in a single write, so a driver must remember the other
channel's state to avoid switching it off by accident.

| Register | Parameter | Encoding |
| --- | --- | --- |
| 20 | Output, **both channels** | `<ch1>,<ch2>` as `0`/`1` |
| 21 / 22 | Waveform | slot index |
| 23 / 24 | Frequency | `<centihertz>,<unit code>`; unit code `0` = Hz |
| 25 / 26 | Amplitude | millivolts |
| 27 / 28 | Offset | 10 mV units biased by 1000 (`1000` = 0 V) |
| 29 / 30 | Duty cycle | percent × 10 |
| 31 | Phase (**single register**) | degrees × 10 |

The frequency unit codes above `0` extend range at the cost of resolution.
Centihertz already covers the full span at full precision, so the driver always
sends code `0`.

## Waveform slots

| Slot | Shape |
| --- | --- |
| 0 | Sine |
| 1 | Square |
| 3 | **Triangle** |

⚠ Slot 3 is a triangle, **not** a sawtooth. A `ramp-up` request is reported as
`substituted: true`, because a triangle is not the asymmetric shape the Spooky2
contact shells call for.
