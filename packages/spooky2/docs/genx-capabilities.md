# Gen X Pro capabilities vs. this driver

What the GeneratorX Pro can do, and how much of it `@freqgen/spooky2` currently
covers. Specifications are from the manufacturer; the "confirmed" column records
what has been verified against a real unit (firmware 200) during this work.

## Device specification

| Spec | Value |
| --- | --- |
| Configuration | 2 independent DDS generators (**4 outputs**), per-generator biofeedback |
| Frequency range | 0 – 40 MHz, all waveforms |
| Frequency resolution | 8 decimal places across the whole range |
| Frequency precision | 50 ppm |
| Waveform | 10-bit × 1024-sample, 300 MSPS sampling |
| Amplitude | 20 Vpp max, 0.01 V resolution |
| Output impedance | 50 Ω, short-circuit protected, ≤ 200 mA |
| Modulation | AM (Out 2 modulates Out 1) |
| Measurement | current + phase angle, high-side, 100 Hz – 40 MHz, 16-bit |
| Measurement resolution | current 3.4 µA, phase 0.0015° |
| Offline operation | up to 30 programs, 200 frequencies each |
| USB | 115200 bps |

Two of these directly confirm decisions in the driver:

- **8 decimal places across the range** matches the exponent frequency encoding
  (`encodeGenXFrequency`): the exponent code carries up to eight places. Verified
  by reading frequencies back off the device display.
- **0.01 V amplitude resolution** confirms the amplitude register is centivolts
  (`GENX_AMPLITUDE_SCALE = 100`).

## Coverage

| Capability | Register(s) | Status | In driver |
| --- | --- | --- | --- |
| Frequency (both outputs) | 24 / 25 | **confirmed on display** | ✅ `setFrequency` |
| Amplitude | 28 / 29 | assignment confirmed (biofeedback); scale = spec | ✅ `setAmplitude` |
| Offset | 32 / 33 | assignment from vendor; scale assumed | ✅ `setOffset` / `setOffsetRatio` |
| Phase (Out 2) | 40 | vendor label | ✅ `setPhase` |
| Output on/off (4 outputs) | 11 | confirmed driving | ✅ `setOutput`, `GenXPair` |
| Waveform: sine, square | 20 / 21 | confirmed (current signature) | ✅ `setWaveform` |
| Waveform inversion | 17 | vendor label | ✅ `setInversion` |
| Gating on/off | 12 / 70 | vendor label | ✅ `setGating` |
| Out 2 modulation on/off | 13 | vendor label | ✅ `setModulation` |
| Out 2 sync | 14 | vendor label | ✅ `setSync` |
| Low-frequency mode | 15 / 51 | vendor label | ✅ `setLowFrequencyMode` |
| Calibration | 50 / 71 | vendor label | ✅ `calibrate` |
| Reset | 95 | vendor label | ✅ `reset` |
| Authentication | 90 / 92 | **confirmed on hardware** | ✅ bundled provider |
| Biofeedback read (current, angle) | r11 / r12 | **confirmed reading live values** | ✅ `readBiofeedback` (raw counts) |
| Biofeedback scan | w24 sweep + r11/r12 | **confirmed by Spooky2 capture** | ✅ `biofeedbackScan` |
| Waveform upload (10-bit × 1024) | `:a<slot>=` | decoded from capture, not HW-tested | ✅ `uploadWaveform` |
| Display text | `:n00=` | confirmed in capture | ✅ `setDisplayText` |
| Offline program upload | `:n`/`:p`/`:g<slot>=` | decoded (freqs = Hz×1e9), not HW-tested | ✅ `uploadProgram` / `writeOfflineSlot` |
| Program running (host-side, dwell) | — | device-agnostic | ✅ `runProgram` |

## Gaps

Ranked by value against how reachable each is without an oscilloscope.

### Reachable now

- **Biofeedback scan.** `readBiofeedback()` / `readCurrent()` / `readPhaseAngle()`
  are exposed by `readBiofeedback()` (raw counts, confirmed live on hardware),
  and `biofeedbackScan()` performs the scan.
- **Raw-count → amps/degrees calibration.** The spec gives 3.4 µA and 0.0015°
  resolution. The capture's analysis export shows Spooky2's displayed
  biofeedback value ≈ `r11 / 100` (raw `r11 ≈ 45300` → "Data" ≈ 453), and its
  scan flags a "hit" when that value deviates from a running average — a simple
  resonance detector. Absolute amps still need a reference meter, but the
  `/100` scaling and the running-average/hit logic are now known.
- **Offset scale confirmation.** Frequency is display-verified and amplitude is
  spec-confirmed (centivolts); offset (centre 120, ±50 span) is still assumed and
  would need a scope or DC meter.

### What a Spooky2 serial capture settled

A capture of the real Spooky2 ↔ device traffic (biofeedback scan + wobble +
running programs) showed that **Spooky2 uses no register this driver does not
already map**. The features that looked like gaps are host-side loops over the
frequency register, not device functions:

- **Biofeedback scan** = write `w24` (frequency), read `r11` (current) and `r12`
  (phase), step, repeat — 92k reads across a fine frequency sweep. Implemented as
  `biofeedbackScan()`.
- **Wobble** = rapid `w24` frequency writes (with `w28`/`w29` amplitude changes) —
  61k writes. No wobble register exists; it is frequency modulation in software,
  reproducible with `setFrequency` in a loop.
- **Running programs** = `w24`/`w28`/`w29` sequencing — covered by
  `runProgram()`.
- **Display text** = `:n00=<text>` (e.g. "Port 3 - General Biofeedback").

### Waveform upload — protocol decoded

The 23 Spooky2 waveforms are uploaded, not selected from 23 live slots. The
capture revealed the command: **`:a<slot>=<s0>,<s1>,…,`** carries the whole
1024-point table in one write, each sample a 10-bit value (0–1023, mid-scale
512). `uploadWaveform(slot, samples)` now emits exactly this (scaling a
normalised −1…+1 table, e.g. `SPOOKY2_WAVEFORMS`, to 10-bit); `setWaveform(ch,
slot)` selects it. Not yet hardware-verified, but reproduced from the captured
form. This is the path to the full waveform set.

### Offline program upload — decoded and implemented

Standalone programs are stored across per-slot commands, all decoded from the
capture:

- `:n<slot>=<name>` — program/waveform name (`:n06=(-)-beta-Elemene`)
- `:p<slot>=<waveformSlot>,<amp×100>,<offset=120>,<dwell>,<count>,<f0×1e9>,…,` — parameters
- `:g<slot>=<gate schedule>` — gating (all-zero = none)
- `:a<slot>=<samples>` — the waveform table (above)

The frequency field is **integer nanohertz** (`round(Hz × 1e9)`) — proven by
matching the stored values against the scan's own hit frequencies
(`1408287935392270` ÷ 1e9 = 1408287.93539227 Hz). This is a *different* encoding
from the live `w24` exponent form. `uploadProgram(slot, {...})` builds the whole
sequence; `writeOfflineSlot()` remains for raw field access. The dwell unit and
offset span are assumed to match the live device and aren't independently
verified, and none of it is hardware-tested yet.

Sweep and gating *configuration* were not exercised in the capture, but nothing
suggests they use registers outside the mapped set.

### Spectrum — understood, math implemented

The Spooky2 User's Guide settled how "Spectrum" (and the DNA molecular
frequencies) reach the device: a Spectrum is **not** thousands of frequency
commands. One center frequency plus a tolerance and a Wave Cycle Multiplier
defines a cluster of child frequencies, which Spooky2 bakes into a computed
1024-sample waveform (the `:a<slot>=` upload) played at the center. The `spectrum`
helpers implement the guide's formulas exactly:

```
Frequency Spacing = Center × Tolerance
Spectrum %        = WCM × 100 × FrequencySpacing ÷ Center
children          = Center + k × Spacing,  k = −WCM … +WCM   (2·WCM+1 total)
```

Verified against the guide's worked examples. What the guide does **not** give is
the sample-by-sample algorithm that turns a child-frequency cluster into the
1024-point waveform, so generating the actual composite table is still open —
but the frequency math, and the fact that it rides in a waveform rather than a
command stream, are settled. The guide's nine base waveforms (sine, square,
sawtooth, inverted sawtooth, triangle, damped sine/square, sine/square H-bomb)
match `SPOOKY2_WAVEFORMS`.

## Summary

A capture of the real Spooky2 protocol confirmed the important thing: **the
live-control register map is complete.** Frequency, amplitude, offset, phase,
waveform (sine/square), output, inversion, gating/sync/modulation toggles,
low-frequency mode, calibration, reset, authentication, biofeedback read **and
scan**, and program running are all implemented, and the core path plus the
biofeedback detector are hardware-verified. Spooky2's wobble and scan turned out
to be host-side loops over the frequency register, not device features, so they
need no new protocol.

What genuinely remains: the **full waveform set via upload** (the device takes
1024-sample tables, which we ship but don't yet push), the **offline program
upload** (`:n<slot>=` — standalone operation, low priority), and confirming
**sweep / configurable gating** (not exercised in the capture, but no evidence
they use unmapped registers). Plus absolute **calibration** of amplitude/offset/
biofeedback counts, which needs a meter, not more protocol work.
