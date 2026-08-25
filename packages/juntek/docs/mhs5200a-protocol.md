# MHS-5200A serial protocol

MHINSTEK / JUNTEK hardware, usually sold under the Koolertron brand.

**Verification status: unverified.** Derived from `peterska/go-mhs5200a`,
`raplin/python_mhs5200` and the sigrok project, not from measurements.

## Link

| Setting | Value |
| --- | --- |
| Baud rate | 57600 |
| Data bits / parity / stop bits | 8 / none / 1 |
| USB bridge | PL2303 (`067b:2303`) |

## Framing

```
:s<channel><letter><value>\n     →     ok
```

Channels are numbered **from 1** on the wire, unlike the register arithmetic the
JDS6600 uses.

| Letter | Parameter | Encoding |
| --- | --- | --- |
| `f` | Frequency | centihertz |
| `w` | Waveform | slot index |
| `a` | Amplitude | centivolts, **at 0 dB attenuation** |
| `o` | Offset | percent of amplitude, biased by 120 (`120` = 0) |
| `d` | Duty cycle | percent × 10 |
| `p` | Phase | whole degrees |
| `b` | Output, **device-global** | `0` / `1`, always addressed as channel 1 |
| `y` | Attenuation | `1` = 0 dB |

## Waveform slots

| Slot | Shape |
| --- | --- |
| 0 | Sine |
| 1 | Square |
| 2 | Triangle |
| 3 | Rising ramp |

Note slot 3 differs from the JDS6600, where it is a triangle.

## Two behaviours that are not just encoding

**Output on/off is device-global.** There is one switch for the whole
instrument, not one per channel. The driver keeps a per-channel intent, drives
the hardware switch from whether *either* channel wants output, and silences an
unwanted channel by writing 0 V. Amplitude writes to a muted channel are
remembered rather than sent, so enabling it later does not resurrect a stale
level.

**Amplitude depends on the attenuator.** `:s<ch>a<value>` is relative to the
attenuator setting, so the driver pins it to 0 dB (`y1`) on connect. Without
that, `setAmplitude(0, 5)` would mean 5 V or 0.5 V depending on how the front
panel was left.
