# FeelTech FY Series — USB Serial Communication Protocol

Manufacturer: 飞逸科技 (FeelTech), www.feeltech.net  
Sources: FY2300 protocol Rev 1.2, FY6900 protocol Rev 1.8, [fygen library](https://github.com/mattwach/fygen)

---

## Table of Contents

1. [Supported Models](#1-supported-models)
2. [Physical Connection](#2-physical-connection)
3. [Serial Port Parameters](#3-serial-port-parameters)
4. [Protocol Basics](#4-protocol-basics)
5. [Command Structure](#5-command-structure)
6. [Main Channel (CH1) Commands](#6-main-channel-ch1-commands)
7. [Auxiliary Channel (CH2) Commands](#7-auxiliary-channel-ch2-commands)
8. [Modulation Commands](#8-modulation-commands)
9. [Measurement Commands](#9-measurement-commands)
10. [Sweep Commands](#10-sweep-commands)
11. [System Setting Commands](#11-system-setting-commands)
12. [Waveform Type Tables](#12-waveform-type-tables)
13. [Parameter Encoding Reference](#13-parameter-encoding-reference)
14. [Model Differences Summary](#14-model-differences-summary)
15. [Implementation Notes & Known Quirks](#15-implementation-notes--known-quirks)

---

## 1. Supported Models

| Family | Models | Baud Rate | Protocol Notes |
|--------|--------|-----------|----------------|
| FY2300 | FY2300A, FY2350, etc. | 9600 | Older protocol, integer frequency in µHz |
| FY6300 | FY6300, FY6600 | 115200 | Decimal frequency format |
| FY6800 | FY6800 | 115200 | Decimal frequency format |
| FY6900 | FY6900 | 115200 | Most features, 64 arbitrary waveform slots |
| FY8300 | FY8300 | 115200 | Decimal frequency format |

The FY2300 uses a different (simpler, older) protocol than the FY63xx/FY68xx/FY69xx/FY83xx families. Most differences are covered in [Section 14](#14-model-differences-summary).

---

## 2. Physical Connection

All models connect via **USB** and appear as a CDC-ACM virtual serial port:

- **Linux:** `/dev/ttyUSB0` (or `/dev/ttyACM0`)
- **macOS:** `/dev/tty.usbserial-*`
- **Windows:** `COMx`

The USB chip is typically a CH340 or CP2102. No driver is required on modern Linux/macOS; on Windows, install the CH340 or CP210x driver.

---

## 3. Serial Port Parameters

### FY2300

| Parameter | Value |
|-----------|-------|
| Baud rate | **9600** |
| Data bits | 8 |
| Parity | None |
| Stop bits | 1 |
| Flow control | None |

### FY6300 / FY6600 / FY6800 / FY6900 / FY8300

| Parameter | Value |
|-----------|-------|
| Baud rate | **115200** |
| Data bits | 8 |
| Parity | None |
| Stop bits | **2** (critical — device does not respond with 1 stop bit) |
| Flow control | None (RTS/CTS, DSR/DTR, XON/XOFF all disabled) |

> **Note:** The 2-stop-bit requirement for FY6900 is not mentioned in the official PDF but is required for reliable operation. The fygen library enforces this.

---

## 4. Protocol Basics

### Command terminator

Every command ends with `0x0a` (ASCII newline, `\n`).

### Direction

Commands are always sent **from the PC to the device**. The device never sends unsolicited data.

### Write commands (set parameters)

- PC sends: `<COMMAND><VALUE>\n`
- FY2300 response: **none** (silent execution)
- FY6900 response: `0x0a` (a single newline byte acknowledging execution)

### Read commands (query parameters)

- PC sends: `<COMMAND>\n`
- Device responds with the value as an ASCII string, **followed by** `0x0a`

### Maximum command length

- FY2300: **18 characters** including the terminating `0x0a`
- FY6900: not explicitly limited in the spec

### Initialization (FY6900 / fygen library)

Before sending commands, the fygen library sends **three newlines** (`\n\n\n`) to synchronize. This clears any partially received command from a previous session.

### Empirical response framing (verified on FY6300-60M)

```
>>> "UMO\n"                  <<< "FY6300-60M\n\n\n\n"   (value + 3 trailing empties)
>>> "RMF\n"                  <<< "00001000.000000\n\n"  (value + 1 trailing empty)
>>> "RMA\n"                  <<< "10000\n\n"            (value + 1 trailing empty)
>>> "WMF00001000.000000\n"   <<< "\n"                   (1-byte ack, no value)
>>> "WMA1.0000\n"             <<< "\n"                   (1-byte ack)
```

A robust client should:

1. After a **write**: read **one** line (the ack), or accept a short timeout (FY2300 sends nothing).
2. After a **read**: read until the first non-empty line is received, **then drain** any trailing empty lines with a short idle timeout (≈25 ms).
3. Skip the per-command drain only if you know the device sends exactly one line.

---

## 5. Command Structure

### Command prefix scheme

| Prefix | Channel / Function |
|--------|--------------------|
| `WM`   | Write — Main channel (CH1) |
| `RM`   | Read — Main channel (CH1) |
| `WF`   | Write — Sub/Auxiliary channel (CH2) |
| `RF`   | Read — Sub/Auxiliary channel (CH2) |
| `WP`   | Write — Modulation / trigger |
| `RP`   | Read — Modulation / trigger |
| `WC`   | Write — Counter / measurement config |
| `RC`   | Read — Counter / measurement |
| `SO`/`SS`/`SE`/`ST`/`SM`/`SB`/`SX` | Sweep parameters |
| `US`/`RS`/`UB`/`RB`/`UM`/`RM`/`UU`/`RU`/`UI`/`UO` | System settings |

### General command format

```
COMMAND + VALUE + 0x0a
```

Examples:
```
WMW00\n      → Set main waveform to sine
WMF00010000000000\n  → Set main frequency to 10 kHz (FY2300, µHz integer)
WMF00010000.000000\n → Set main frequency to 10 kHz (FY6900, Hz decimal)
RMW\n        → Read main waveform type
```

---

## 6. Main Channel (CH1) Commands

### Write Commands

| Command | Format | Description | Example |
|---------|--------|-------------|---------|
| `WMW` | `WMWxx\n` | Set waveform type (2-digit code) | `WMW00` = sine |
| `WMF` | `WMFxxxxxxxxxxxxxx\n` | Set frequency (14-digit µHz integer or Hz decimal) | `WMF00010000000000` = 10 kHz |
| `WMA` | `WMAxx.xx\n` | Set amplitude in volts | `WMA5.00` = 5.00 V |
| `WMO` | `WMOxx.xx\n` | Set offset/bias in volts (signed) | `WMO-1.50` = −1.50 V |
| `WMD` | `WMDxx.x\n` | Set duty cycle in percent (3 digits, 1 decimal) | `WMD50.1` = 50.1% |
| `WMP` | `WMPxxx\n` (FY2300) / `WMPxxx.x\n` (FY6900) | Set phase in degrees | `WMP180` = 180° |
| `WMT` | `WMTx\n` | Set attenuation: 0 = 0 dB, 1 = −20 dB | `WMT0` = no attenuation |
| `WMN` | `WMNx\n` | Enable/disable output: 0 = off, 1 = on | `WMN1` = output on |
| `WMS` | `WMSxxxx\n` | Set pulse period in nanoseconds (FY6900 only) | `WMS10000` = 10 000 ns |

#### Trigger / modulation (FY2300 main channel)

| Command | Format | Description |
|---------|--------|-------------|
| `WPM` | `WPMx\n` | Set trigger mode (see [Section 8](#8-modulation-commands)) |
| `WPN` | `WPNxxxxxxx\n` | Set trigger pulse count (max 1048575) |

### Read Commands

| Command | Returns | Description | Decode |
|---------|---------|-------------|--------|
| `RMW` | Integer | Current waveform code | See [Section 12](#12-waveform-type-tables) |
| `RMF` | Integer (FY2300) / `ddddddd.dddddd` (FY6900) | Current frequency | FY2300: Hz integer; FY6900: Hz with 6 decimals |
| `RMA` | Integer | Current amplitude | integer / 100 = V (FY2300), integer / **10000** = V (FY6900 — the PDF claims /1000, real firmware uses /10000; see [Section 13](#13-parameter-encoding-reference)) |
| `RMO` | Integer | Current offset | See [Section 13](#13-parameter-encoding-reference) |
| `RMD` | Integer | Current duty cycle | integer / 10 = % (FY2300, e.g. 689 = 68.9%); integer / **1000** = % (FY6900, e.g. 50000 = 50.0%) |
| `RMP` | Integer | Current phase | integer / **1000** = degrees (FY6900, e.g. 90000 = 90.000°); integer = degrees (FY2300) |
| `RMT` | Integer | Current attenuation | 0 = 0 dB, 1 = −20 dB |
| `RMN` | Integer | Output status | 0 = off, 255 = on |
| `RPM` | Integer | Current trigger mode | See [Section 8](#8-modulation-commands) |
| `RPN` | Integer | Current trigger pulse count | |
| `RSS` | Integer | Pulse period in ns (FY6900 only) | |

---

## 7. Auxiliary Channel (CH2) Commands

The auxiliary (sub/secondary) channel uses the same parameter commands as CH1 but with `WF`/`RF` prefixes instead of `WM`/`RM`.

### Write Commands

| Command | Description |
|---------|-------------|
| `WFW` | Set waveform type |
| `WFF` | Set frequency |
| `WFA` | Set amplitude |
| `WFO` | Set offset/bias |
| `WFD` | Set duty cycle |
| `WFP` | Set phase |
| `WFT` | Set attenuation |
| `WFN` | Enable/disable output |

All formats are identical to the main channel equivalents.

### Read Commands

| Command | Description |
|---------|-------------|
| `RFW` | Read waveform type |
| `RFF` | Read frequency |
| `RFA` | Read amplitude |
| `RFO` | Read offset |
| `RFD` | Read duty cycle |
| `RFP` | Read phase |
| `RFT` | Read attenuation |
| `RFN` | Read output status |

---

## 8. Modulation Commands

### FY6900 Modulation Mode (WPF / RPF)

| Command | Format | Description |
|---------|--------|-------------|
| `WPF` | `WPFx\n` | Set modulation mode |
| `RPF` | `RPF\n` | Read modulation mode |

| Value | Mode |
|-------|------|
| 0 | ASK (Amplitude Shift Keying) |
| 1 | FSK (Frequency Shift Keying) |
| 2 | PSK (Phase Shift Keying) |
| 3 | Trigger / Burst |
| 4 | AM (Amplitude Modulation) |
| 5 | FM (Frequency Modulation) |
| 6 | PM (Phase Modulation) |

### Modulation Source (WPM / RPM)

Controls the signal source driving the modulation.

#### FY6900

| Command | `WPMx\n` | Read: `RPM\n` |
|---------|----------|----------------|

| Value | Source |
|-------|--------|
| 0 | Second channel (CH2 / subsidiary wave) |
| 1 | External AC coupling input |
| 2 | Manual (software trigger) |
| 3 | External DC coupling input |

#### FY2300

| Value | Source / Mode |
|-------|---------------|
| 0 | No trigger (free-running) |
| 1 | Second channel (CH2) trigger |
| 2 | External trigger (EXT input) |
| 3 | Manual — each `WPM3` command fires one cycle |

### Trigger Pulse Count (WPN / RPN)

| Command | Format | Description |
|---------|--------|-------------|
| `WPN` | `WPNxxxxxxx\n` | Set burst pulse count (max 1048575) |
| `RPN` | `RPN\n` | Read current burst count |

Example: `WPN10` → output 10 waveform cycles per trigger event.

### Manual Trigger (WPO) — FY6900 only

| Command | Format | Description |
|---------|--------|-------------|
| `WPO` | `WPO\n` | Fire one manual trigger event |

### FSK Second Frequency (WFK / RFK) — FY6900 only

| Command | Format | Description |
|---------|--------|-------------|
| `WFK` | `WFKxxxxxxx.x\n` | Set FSK hop frequency in Hz | 
| `RFK` | `RFK\n` | Read FSK hop frequency |

Example: `WFK123.4` → FSK second frequency = 123.4 Hz.

### AM Modulation Rate (WPR / RPR) — FY6900 only

| Command | Format | Description |
|---------|--------|-------------|
| `WPR` | `WPRx x x.x\n` | Set AM modulation rate in % |
| `RPR` | `RPR\n` | Read AM modulation rate |

Example: `WPR50.1` → 50.1% AM depth.

### FM Frequency Offset (WFM / RFM) — FY6900 only

| Command | Format | Description |
|---------|--------|-------------|
| `WFM` | `WFM x xxxxxxx.x\n` | Set FM frequency deviation in Hz |
| `RFM` | `RFM\n` | Read FM frequency deviation |

Example: `WFM 123.4` → FM deviation = 123.4 Hz.

### PM Phase Offset (WPP / RPP) — FY6900 only

| Command | Format | Description |
|---------|--------|-------------|
| `WPP` | `WPPxxx.xx\n` | Set PM phase offset in degrees |
| `RPP` | `RPP\n` | Read PM phase offset |

Example: `WPP150.12` → PM phase offset = 150.12°.

---

## 9. Measurement Commands

These commands control the built-in frequency counter / measurement input (EXT input terminal).

### Counter Reset (WCZ)

| Command | Format | Description |
|---------|--------|-------------|
| `WCZ` | `WCZx\n` | Reset counter. `WCZ0` = reset |

### Measurement Pause (WCP)

| Command | Format | Description |
|---------|--------|-------------|
| `WCP` | `WCPx\n` | Pause counter. `WCP0` = pause |

### Gate Time (WCG / RCG)

Controls the measurement window duration, which determines frequency resolution.

| Command | Format | Description |
|---------|--------|-------------|
| `WCG` | `WCGx\n` | Set gate time |
| `RCG` | `RCG\n` | Read gate time |

| Value | Gate Time | Frequency Resolution |
|-------|-----------|----------------------|
| 0 | 1 s | e.g. returned 668 = 668 Hz |
| 1 | 10 s | e.g. returned 668 = 66.8 Hz |
| 2 | 100 s | e.g. returned 668 = 6.68 Hz |

> **Note:** Always read the current gate time (`RCG`) before interpreting `RCF` results, to determine where to place the decimal point.

### Coupling Mode (WCC) — Measurement Input

| Command | Format | Description |
|---------|--------|-------------|
| `WCC` | `WCCx\n` | Set input coupling: `WCC0` = DC, `WCC1` = AC |

### Read Measurement Data

| Command | Description | Return value |
|---------|-------------|--------------|
| `RCF` | Read measured frequency | Integer; apply gate-time factor for actual Hz |
| `RCC` | Read pulse count | Integer (raw count) |
| `RCT` | Read signal period | Integer in nanoseconds |
| `RC+` | Read positive pulse width | Integer in nanoseconds |
| `RC-` | Read negative pulse width | Integer in nanoseconds |
| `RCD` | Read duty cycle of measured signal | Integer; integer / 10 = % on **all families** (e.g. 668 = 66.8%) — unlike the channel readback `RMD` |

---

## 10. Sweep Commands

Sweep linearly or logarithmically scans a parameter (frequency, amplitude, offset, or duty cycle) over time.

### Sweep Object (SOB)

| Command | Format | Description |
|---------|--------|-------------|
| `SOB` | `SOBx\n` | Set the parameter to sweep |

| Value | Sweep Object |
|-------|--------------|
| 0 | Frequency |
| 1 | Amplitude |
| 2 | Offset |
| 3 | Duty Cycle |

### Sweep Start (SST) and End (SEN) Values

The format depends on which parameter is being swept:

| Sweep Object | SST Format | SEN Format | Unit / Example |
|--------------|-----------|-----------|----------------|
| Frequency | `SSTxxxxxxx.x\n` | `SENxxxxxxx.x\n` | Hz — `SST1000.0` = 1000.0 Hz |
| Amplitude | `SSTxx.xxx\n` | `SENxx.xxx\n` | V — `SST10.001` = 10.001 V |
| Offset | `SSTxx.xxx\n` | `SENxx.xxx\n` | V (signed) — `SST-6.000` = −6.000 V |
| Duty Cycle | `SSTxx.x\n` | `SENxx.x\n` | % — `SST68.9` = 68.9% |

> **Note (FY6900 sweep offset):** Due to a firmware quirk, the offset sweep requires a +10 V bias applied to the start/end values. The fygen library adds this automatically.

If the value exceeds the parameter's maximum, the device clamps to the maximum.

### Sweep Time (STI)

| Command | Format | Description |
|---------|--------|-------------|
| `STI` | `STIxxx.xx\n` | Set sweep duration in seconds |

Example: `STI68.9` = 68.9 s sweep.

### Sweep Mode (SMO)

| Command | Format | Description |
|---------|--------|-------------|
| `SMO` | `SMOx\n` | 0 = linear sweep, 1 = logarithmic sweep |

### Sweep Control Source (SXY)

| Command | Format | Description |
|---------|--------|-------------|
| `SXY` | `SXYx\n` | 0 = time-controlled, 1 = VCO IN analog input |

### Sweep Enable (SBE)

| Command | Format | Description |
|---------|--------|-------------|
| `SBE` | `SBEx\n` | 0 = stop sweep, 1 = start sweep |

---

## 11. System Setting Commands

### Save / Load Parameters (USN / ULN)

Both channels' parameters (waveform, frequency, amplitude, offset, duty cycle) can be saved to and loaded from numbered storage slots.

| Command | Format | Description |
|---------|--------|-------------|
| `USN` | `USNxx\n` | Save current parameters to slot xx (01–99) |
| `ULN` | `ULNxx\n` | Load parameters from slot xx |

Examples: `USN06` = save to slot 6, `ULN01` = load from slot 1.

> **Auto-load:** If slot 1 has saved data, the device automatically loads it at power-on.

### Channel Synchronization (USA / USD / RSA)

Locks CH2 parameters to follow CH1 automatically.

| Command | Format | Description |
|---------|--------|-------------|
| `USA` | `USAx\n` | Enable synchronization for object x |
| `USD` | `USDx\n` | Disable synchronization for object x |
| `RSA` | `RSAx\n` | Read synchronization status for object x |

| Value | Synchronized Object |
|-------|---------------------|
| 0 | Waveform type |
| 1 | Frequency |
| 2 | Amplitude |
| 3 | Offset |
| 4 | Duty cycle |

`RSA` returns: 0 = not synchronized, 255 = synchronized.

> **Note:** Synchronization is not available while sweep is active.

### Buzzer (UBZ / RBZ)

| Command | Format | Description |
|---------|--------|-------------|
| `UBZ` | `UBZx\n` | 0 = buzzer off, 1 = buzzer on |
| `RBZ` | `RBZ\n` | Read buzzer status (0 = off, 255 = on) |

### Uplink / Cascade Mode (UMS / RMS / UUL / RUL)

Allows multiple units to be chained (master/slave cascade).

| Command | Format | Description |
|---------|--------|-------------|
| `UMS` | `UMSx\n` | Set role: 0 = master, 1 = slave |
| `RMS` | `RMS\n` | Read role: 0 = master, 255 = slave |
| `UUL` | `UULx\n` (FY2300: `UMLx\n`) | 0 = disable uplink, 1 = enable uplink |
| `RUL` | `RUL\n` | Read uplink status: 0 = off, 255 = on |

### Device Identity

| Command | Description |
|---------|-------------|
| `UID` | Read device ID number |
| `UMO` | Read device model string |

---

## 12. Waveform Type Tables

### FY2300 Waveform Codes (WMW / WFW)

Both main and auxiliary channels share the same waveform list.

| Code | Waveform | Code | Waveform |
|------|----------|------|----------|
| 00 | Sine | 16 | Positive Half Wave |
| 01 | Rectangular | 17 | Negative Half Wave |
| 02 | Triangle / Square | 18 | Positive Half Wave Rectification |
| 03 | Rise Sawtooth | 19 | Negative Half Wave Rectification |
| 04 | Fall Sawtooth | 20 | Lorenz Pulse |
| 05 | Step Triangle | 21 | Multitone |
| 06 | Positive Step | 22 | Noise |
| 07 | Inverse Step | 23 | Electrocardiogram (ECG) |
| 08 | Positive Exponent | 24 | Trapezoidal Pulse |
| 09 | Inverse Exponent | 25 | Sinc Pulse |
| 10 | Positive Falling Exponent | 26 | Narrow Pulse |
| 11 | Inverse Falling Exponent | 27 | Gauss White Noise |
| 12 | Positive Logarithm | 28 | AM |
| 13 | Inverse Logarithm | 29 | FM |
| 14 | Positive Falling Logarithm | 30 | Linear FM |
| 15 | Inverse Falling Logarithm | 31–46 | Arbitrary 1–16 |

Arbitrary waveforms: code = 31 + (n − 1), so Arbitrary1 = 31, Arbitrary16 = 46.

---

### FY6900 Main Channel Waveform Codes (WMW / RMW)

| Code | Waveform | Code | Waveform |
|------|----------|------|----------|
| 0 | SINE | 19 | P-Fall-Log |
| 1 | Square | 20 | N-Fall-Log |
| 2 | Rectangle | 21 | P-Full-Wav |
| 3 | Trapezoid | 22 | N-Full-Wav |
| 4 | CMOS | 23 | P-Half-Wav |
| 5 | Adj-Pulse | 24 | N-Half-Wav |
| 6 | DC | 25 | Lorentz-Pu |
| 7 | TRGL (Triangle) | 26 | Multitone |
| 8 | Ramp | 27 | Random-Noi |
| 9 | NegRamp | 28 | ECG |
| 10 | Stair TRGL | 29 | Trapezoid |
| 11 | Stairstep | 30 | Sinc-Pulse |
| 12 | NegStair | 31 | Impulse |
| 13 | PosExponen | 32 | AWGN |
| 14 | NegExponen | 33 | AM |
| 15 | P-Fall-Exp | 34 | FM |
| 16 | N-Fall-Exp | 35 | Chirp |
| 17 | PosLogarit | 36 | Impulse (2nd) |
| 18 | NegLogarit | 37–99 | Arbitrary 1–64 |

Arbitrary waveforms: code = 37 + (n − 1), so Arbitrary1 = 37, Arbitrary64 = 99 (= `WMW99`).

---

### FY6900 Auxiliary Channel Waveform Codes (WFW / RFW)

The auxiliary channel has one fewer built-in waveform (no **Adj-Pulse**), shifting all subsequent codes by −1 relative to the main channel.

| Code | Waveform | Code | Waveform |
|------|----------|------|----------|
| 0 | SINE | 18 | P-Fall-Log |
| 1 | Square | 19 | N-Fall-Log |
| 2 | Rectangle | 20 | P-Full-Wav |
| 3 | Trapezoid | 21 | N-Full-Wav |
| 4 | CMOS | 22 | P-Half-Wav |
| 5 | DC | 23 | N-Half-Wav |
| 6 | TRGL | 24 | Lorentz-Pu |
| 7 | Ramp | 25 | Multitone |
| 8 | NegRamp | 26 | Random-Noi |
| 9 | Stair TRGL | 27 | ECG |
| 10 | Stairstep | 28 | Trapezoid |
| 11 | NegStair | 29 | Sinc-Pulse |
| 12 | PosExponen | 30 | Impulse |
| 13 | NegExponen | 31 | AWGN |
| 14 | P-Fall-Exp | 32 | AM |
| 15 | N-Fall-Exp | 33 | FM |
| 16 | PosLogarit | 34 | Chirp |
| 17 | NegLogarit | 35 | Impulse (2nd) |
| | | 36–98 | Arbitrary 1–64 |

Arbitrary waveforms: code = 36 + (n − 1), so Arbitrary1 = 36, Arbitrary64 = 98.

---

## 13. Parameter Encoding Reference

### Frequency

#### FY2300 (integer µHz)

- Format: 14-digit decimal integer, unit = µHz
- `WMF` value = frequency_Hz × 1,000,000 (padded to 14 digits)

```
WMF00010000000000  →  10 kHz  (10000000000 µHz)
WMF00000000100000  →  100 mHz (100000 µHz)
WMF00000000000001  →  1 µHz
```

Reading back (`RMF`): device returns integer in Hz.

#### FY6300 / FY6900 / FY8300 (decimal Hz)

- Format: `%015.6f` — 15 characters total, 6 decimal places, unit = Hz

```
WMF00010000.000000  →  10 kHz
WMF00000000.000001  →  1 µHz
WMF00000000.100000  →  100 mHz
```

Reading back (`RMF`): device returns `ddddddd.dddddd` in Hz.

---

### Amplitude

#### FY2300

- Write: `WMAxx.xx` — decimal volts with 2 decimal places
- Read (`RMA`): integer; actual voltage = integer / 100
  - e.g. returns `1000` → 10.00 V

#### FY6300 / FY6900 family

- Write: `WMAxx.xxxx` — decimal volts with up to 4 decimal places
- Read (`RMA`): integer; actual voltage = integer / **10000**
  - e.g. returns `10000` → 1.000 V (verified on FY6300-60M)
  - e.g. returns `33000` → 3.300 V

> **Important:** The official FY6900 protocol PDF (Rev 1.8) claims the divisor
> is `1000` and gives the example `00000010000 → 10.000 V`. Real firmware
> on FY6300 / FY6900 uses **`/10000`**. The `fygen` Python library uses the
> same `/10000` divisor. Trust the device, not the PDF.

---

### Offset / Bias

#### FY2300

- Write: `WMOxx.xx` — signed decimal volts (e.g. `WMO-2.35`)
- Read (`RMO`): unsigned integer with bias of 1000

```
Decode:
  if returned < 1000:  offset = -(1000 - returned) / 100  V
  if returned == 1000: offset = 0 V
  if returned > 1000:  offset = (returned - 1000) / 100  V

Examples:
  611  →  -(1000 - 611) / 100 = -3.89 V
  1000 →  0 V
  1678 →  (1678 - 1000) / 100 = +6.78 V
```

#### FY6300 / FY6900 family

- Write: `WMOxx.xxx` — signed decimal volts (e.g. `WMO-2.351`)
- Read (`RMO`): **signed 32-bit integer** divided by 1000

```
Decode:
  signed = raw >= 0x80000000 ? raw - 0x100000000 : raw
  offset = signed / 1000  V

Examples (verified on FY6300-60M):
  0          →  0 V
  1000       →  +1.000 V
  4294966062 →  (4294966062 - 4294967296) / 1000 = -1.234 V
```

> **PDF note:** The FY6900 protocol PDF Rev 1.8 describes a 10000-bias formula
> (`offset = (raw − 10000) / 1000`). Real firmware uses two's-complement instead.
> The `fygen` library uses the two's-complement decode as well.

---

### Duty Cycle

- Write: `WMDxx.x` — percentage with 1 decimal place
  - `WMD50.1` = 50.1%
- Read (`RMD`):
  - **FY2300:** integer / 10 — e.g. `689` → 68.9 %
  - **FY6300/6900 family:** integer / **1000** — e.g. `50000` → 50.0 %
    (verified on FY6300-60M; PDF Rev 1.8 incorrectly states `/10`)

---

### Phase

#### FY2300

- Write: `WMPxxx` — integer degrees
  - `WMP123` = 123°
- Read (`RMP`): integer degrees directly

#### FY6300 / FY6900 family

- Write: `WMPxxx.xxx` — decimal degrees (up to 3 decimals)
  - `WMP123.456` = 123.456°
- Read (`RMP`): integer / **1000** = degrees
  - `90000` → 90.000° (verified on FY6300-60M)
  - PDF Rev 1.8 states `/10` — wrong; real firmware uses `/1000`

---

### Output Enable / Boolean Flags

Returned as: `0` = off/disabled/false, `255` = on/enabled/true.

---

### Arbitrary Waveform Upload

The FY series supports uploading custom waveforms to the arbitrary waveform slots.

- Each sample is a **14-bit** value (range 0–16383)
- Values are packed as byte pairs: low byte (bits 0–7) + high byte (bits 6–13, upper 6 bits)
- The upload command is `DDS_WAVE<n>` followed by the raw sample data
- The device acknowledges each packet with `W` and signals completion with `HN`
- FY2300 supports 16 arbitrary slots (ARB1–ARB16)
- FY6900 supports 64 arbitrary slots (ARB1–ARB64)

---

## 14. Model Differences Summary

| Feature | FY2300 | FY6300/6600/6800 | FY6900 |
|---------|--------|------------------|--------|
| Baud rate | 9600 | 115200 | 115200 |
| Stop bits | 1 | 2 | 2 |
| Write ACK | None | `0x0a` | `0x0a` |
| Frequency format | 14-digit µHz int | Decimal Hz | Decimal Hz |
| Amplitude resolution | 0.01 V | 0.001 V | 0.001 V |
| Phase resolution | 1° | 0.1° | 0.1° |
| Max built-in waveforms | 31 (codes 0–30) | ~35 | 37 (codes 0–36) |
| Arbitrary waveform slots | 16 | varies | 64 |
| Modulation modes | Trigger only | ASK/FSK/PSK/AM/FM | ASK/FSK/PSK/AM/FM/PM |
| Modulation source codes | 0=none, 1=CH2, 2=EXT, 3=manual | 0=CH2, 1=EXT-AC, 2=manual, 3=EXT-DC | same as FY6300 |
| Sweep commands | Yes | Yes | Yes |
| WMS (pulse period) command | No | No | Yes |
| WPO (manual trigger) command | No | No | Yes |
| WFK / WFM / WPP (mod params) | No | No | Yes |
| Max command length | 18 chars | — | — |
| Protocol doc revision | Rev 1.2 | — | Rev 1.8 |

---

## 15. Implementation Notes & Known Quirks

### Stop bits (FY6900)

The FY6900 requires **2 stop bits**. With only 1 stop bit the device accepts commands but responses are corrupt or absent. This is not documented in the official protocol PDF.

### Initialization flush

Before sending commands, send three newlines (`\n\n\n`) with a short delay. This clears any partial command left in the device's UART buffer from a previous connection.

### Response timing

The device may take up to several hundred milliseconds to respond to certain commands (especially frequency reads and arbitrary waveform uploads). Implement a retry/timeout mechanism with at least 500 ms timeout for reads.

### FY2300 silent writes

The FY2300 does **not** send any acknowledgment after a write command. Do not wait for a response after sending a write command to a FY2300.

### FY6900 response format for reads

Read responses are plain ASCII digits followed by `0x0a`. Leading zeros are included for some values (e.g. frequency `00010000.000000`, waveform code `0000000001`). Strip leading zeros before numeric conversion.

### Offset encoding discrepancy (FY6900 PDF)

The FY6900 protocol PDF (Rev 1.8) shows the example value `611` corresponding to −0.389 V, which is inconsistent with the stated formula `(value − 10000) / 1000`. The correct returned value for −0.389 V should be `9611`. The 16782 → +6.782 V example is consistent with the formula. Assume the `611` in the PDF is a typo missing the leading `9`.

### Sweep offset bias

When sweeping offset on FY6900, add 10 V to the start and end values (firmware internally stores offsets with a 10 V bias in sweep mode). The fygen library applies this automatically.

### Channel 2 waveform code offset

The FY6900 auxiliary channel (CH2) is missing the **Adj-Pulse** waveform (code 5 on CH1). All waveforms from code 5 onwards are shifted down by 1 on CH2. Always use the CH2-specific waveform table when constructing `WFW` commands.

### Arbitrary waveform upload timing

Upload large arbitrary waveforms in chunks. Wait for the `W` intermediate acknowledgment per chunk and `HN` for upload complete. Do not flood the UART buffer.

### Reference implementation

The [fygen Python library](https://github.com/mattwach/fygen) by Matt Wach provides a complete, well-tested reference implementation supporting FY2300, FY6300, FY6600, FY6800, FY6900, and FY8300. It handles all the encoding quirks described here and supports modulation, sweep, arbitrary waveforms, and measurements.

```python
# fygen usage example
import fygen
fy = fygen.FYGen(port='/dev/ttyUSB0')
fy.set(0, waveform='sine', freq_hz=1000, amplitude_volts=3.3, offset_volts=0)
fy.enable(0, True)
```

---

*Sources: FeelTech FY2300 Serial Communication Protocol Rev 1.2, FY6900 Serial Communication Protocol Rev 1.8, [github.com/mattwach/fygen](https://github.com/mattwach/fygen)*
