# freqgen

TypeScript drivers for USB-serial signal / frequency generators, sharing one
transport and driver core. Same API in **Node.js** (via `serialport`) and in
**browsers** (via the Web Serial API), from a single source tree.

One vendor-neutral `SignalGenerator` interface drives every device: write
against the interface once, then swap a FeelTech FY for a JDS6600 or a Spooky2
Gen X Pro without touching your code.

> **Formerly `feeltech`.** This repo grew from a single FeelTech package into the
> `@freqgen` monorepo. The old `feeltech` package still works; new work lives
> under the `@freqgen/*` scope.

## Packages

| Package | Directory | What it drives |
| --- | --- | --- |
| `@freqgen/core` | [`packages/core`](packages/core) | Shared transports, `SignalGenerator`, capabilities, limits, octave folding, `runProgram` |
| `@freqgen/feeltech` | [`packages/feeltech`](packages/feeltech) | FeelTech / FeelElec FY-series (+ FY3200S) |
| `@freqgen/juntek` | [`packages/juntek`](packages/juntek) | JUNTEK JDS-series and Koolertron |
| `@freqgen/spooky2` | [`packages/spooky2`](packages/spooky2) | Spooky2 XM, Gen X, Gen X Pro |

## Feature matrix

Seven drivers, one interface. The tables below show what each device can
actually do and which library call does it — so you can pick a device by
capability, and know before you send a command whether it will be honoured,
emulated, or refused.

**Legend** ✅ native command · 🟡 emulated by the driver (no native command) ·
🔄 nearest shape substituted (reported, never silent) · ➖ no such register
(the driver **throws** rather than pretend) · ❌ not implemented

### Unified control — the `SignalGenerator` setters

Every driver implements this interface; `applyStep(channel, step)` (a whole
channel state at once, in the device's required order) works on **all** of them
and is the portable call.

| Device — driver | `setWaveform` | `setFrequency` | `setAmplitude` | `setOffset` | `setDutyCycle` | `setPhase` | `setOutput` |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| FeelTech FY6/8-series — `FeelTech` | ✅ | ✅ | ✅ | ✅ | ✅ ¹ | ✅ | ✅ |
| FeelTech FY2300 — `FeelTech` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| FeelTech FY3200S — `FY3200S` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 ² |
| JUNTEK JDS6600 / CJDS66 — `Jds6600` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Koolertron MHS-5200A — `Mhs5200a` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 ³ |
| Spooky2 XM — `Spooky2XM` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Spooky2 Gen X — `GenXClassic` | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ | ✅ |
| Spooky2 Gen X Pro — `GenXPro` | ✅ | ✅ | ✅ | ✅ | ➖ | ✅ ⁴ | ✅ |

¹ FY6900 ignores duty on Square (fixed 50 %) — `capabilities.dutyGatedByWaveform`.
² FY3200S has no output relay; on/off is written as amplitude (`outputRelay: false`).
³ MHS-5200A has one output switch for the whole instrument (`perChannelOutput: false`).
⁴ Gen X Pro Out 1 has no phase register; phase is set on Out 2 relative to Out 1.

`setWaveform` always returns an `AppliedWaveform` — `{ requested, actual,
substituted, code }` — so a shape the device lacks degrades to the closest
available one *and tells you it did*, rather than silently outputting a sine.

### Waveforms

| Device | Native vendor-neutral shapes | Arbitrary upload |
| --- | --- | --- |
| FeelTech FY6/8-series | sine, square, triangle, ramp-up, ramp-down, dc, noise, custom | ✅ 8192 × 14-bit (`uploadWaveform`) |
| FeelTech FY2300 | sine, square, triangle, ramp-up, ramp-down, noise, custom | ❌ (2048 × 16-bit variant not yet implemented) |
| FeelTech FY3200S | sine, square, ramp-up | ❌ |
| JUNTEK JDS6600 | sine, square, triangle | ❌ |
| Koolertron MHS-5200A | sine, square, triangle, ramp-up | ❌ |
| Spooky2 XM | sine, square, ramp-up, custom | ❌ |
| Spooky2 Gen X | sine, square | ❌ |
| Spooky2 Gen X Pro | sine, square (live) | ✅ 11 Spooky2 sample tables (`uploadWaveform`) |

Any request outside a device's native set is 🔄 substituted and reported. The
eleven verbatim Spooky2 shapes (sine, square, sawtooth, inverted sawtooth,
triangle, the damped pair, the H-bomb pair, two user slots) ship as
`SPOOKY2_WAVEFORMS` and upload to the Gen X Pro.

### Advanced features

| Device | Modulation | HW sweep | Freq. counter | Save / load | HW freq sync | Verified writes | Biofeedback |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| FeelTech FY6/8-series | ✅ ⁵ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| FeelTech FY2300 | ✅ ⁵ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| FeelTech FY3200S | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| JUNTEK JDS6600 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Koolertron MHS-5200A | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Spooky2 XM | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Spooky2 Gen X | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Spooky2 Gen X Pro | 🟡 ⁶ | 🟡 ⁷ | ❌ | ✅ ⁸ | ✅ | ❌ | ✅ ⁹ |

⁵ AM / FM / PM / FSK / PSK / Burst. ⁶ Gen X Pro exposes on/off gating,
modulation, sync and inversion toggles (the vendor shells' functions), not the
FY's keying modes. ⁷ `frequencySweep()` and `biofeedbackScan()` are host-side
loops, not a hardware sweep engine. ⁸ Offline program slots via `loadPreset()`.
⁹ High-side detector reads live output current and phase angle.

### Capability → which library function

Every capability maps to a concrete call. Anything in `@freqgen/core` works on
**any** `SignalGenerator`.

| Capability | Library entry point | Package |
| --- | --- | --- |
| Apply a whole channel state (portable) | `gen.applyStep(ch, step)` | any driver |
| Run a frequency program (steps + dwell, repeat, abort) | `runProgram(gen, steps, opts)` | `@freqgen/core` |
| Octave-fold an out-of-band frequency set | `foldToBand()`, `fitFrequencies()` | `@freqgen/core` |
| Frequency limit + its provenance | `resolveCap(limits, kind)` | `@freqgen/core` |
| Introspect what a device can do | `gen.capabilities` | any driver |
| Modulation (AM/FM/PM/FSK/PSK/Burst) | `fy.setModulationMode()`, `setAmModulationRate()`, `setBurstCount()` | `@freqgen/feeltech` |
| Hardware sweep | `fy.configureSweep()` + `startSweep()` / `stopSweep()` | `@freqgen/feeltech` |
| Frequency counter / pulse-width | `fy.readMeasurement()`, `setGateTime()` | `@freqgen/feeltech` |
| Arbitrary waveform upload | `fy.uploadWaveform()` · `pro.uploadWaveform()` | feeltech · spooky2 |
| Save / load device state | `fy.saveState()` / `loadState()` | `@freqgen/feeltech` |
| Hardware CH2→CH1 frequency sync | `fy.enableSync()` · `xm.setSync()` · `pro.setSync()` | feeltech · spooky2 |
| Gen X Pro gating / inversion / modulation / low-freq | `pro.setGating()`, `setInversion()`, `setModulation()`, `setLowFrequencyMode()` | `@freqgen/spooky2` |
| Biofeedback (live current + phase, scan) | `pro.readBiofeedback()`, `pro.biofeedbackScan()` | `@freqgen/spooky2` |
| Parse a Spooky2 preset (with `Base_Preset` inheritance) | `parsePreset()` · `resolvePresetChain()` | `@freqgen/spooky2` |
| **Run a Spooky2 preset on _any_ generator** | `presetToProgram()` + `runPresetRun(device, run)` | `@freqgen/spooky2` |
| Upload a preset to Gen X Pro offline slots | `pro.loadPreset(preset)` | `@freqgen/spooky2` |
| Spectrum / radionics frequency expansion | `spectrum()`, `spectrumFrequencies()` | `@freqgen/spooky2` |

## Device support & verification

Marks describe verification, not capability — the matrix above is capability.

| Device | Package | Driver | Protocol | Verified |
| --- | --- | --- | --- | --- |
| FY6300 | feeltech | `FeelTech` | 115200 8N2, `WM*`/`WF*`, decimal Hz | ✅ hardware (FY6300-60M) |
| FY6600, FY6800, FY6900, FY8300 | feeltech | `FeelTech` | as above | ◐ protocol verified, model untested |
| FY2300, FY2350 | feeltech | `FeelTech` | 9600 8N1, integer µHz | ⚠️ |
| FY3200S, FY3224S | feeltech | `FY3200S` | 9600 8N1, `b`/`d` prefix, centiHz, no relay | ⚠️ |
| JDS6600, JDS2800, JDS2900 | juntek | `Jds6600` | 115200 8N1, `:w<reg>=<v>.` → `:ok` | ⚠️ |
| JDS8000 | juntek | `Jds6600` | as above | ⚠️ least corroborated |
| CJDS66 (Koolertron) | juntek | `Jds6600` | as above — rebadged JDS6600 | ⚠️ |
| MHS-5200A (Koolertron) | juntek | `Mhs5200a` | 57600 8N1, `:s<ch><letter><val>` | ⚠️ global output switch |
| Spooky2 XM | spooky2 | `Spooky2XM` | 57600 8N1, `:w<reg><val>` + `ok` | ⚠️ |
| Gen X (classic) | spooky2 | `GenXClassic` | 115200 8N1, `:w<reg>=<a>,<b>,` | ⚠️ experimental |
| Gen X Pro | spooky2 | `GenXPro` | as above + auth handshake | ◐ link layer on hardware; output gated behind auth |
| Gen X Pro ×2 | spooky2 | `GenXPair` | two ports, one generator each | ⚠️ |

**✅ hardware** — verified against a real device.
**◐ partial** — the protocol (or link layer) is verified, this particular model / output path is not.
**⚠️** — implemented from documentation, never checked against hardware.
Confirm output with a scope.

Sources: FY series from [`mattwach/fygen`](https://github.com/mattwach/fygen) plus
the official FeelTech PDFs corrected against measurements; FY3200S from the
`sds1004x_bode` driver collection; JDS from `on1arf/jds6600_python` and the Joy-IT
manual; MHS-5200A from `peterska/go-mhs5200a`, `raplin/python_mhs5200` and sigrok;
Spooky2 XM from the `calum74/s2` reimplementation; Gen X from third-party reverse
engineering of the vendor application. Per-driver protocol references live in each
package's `docs/`.

## Quick start

```ts
import { connectNode, Channel } from "@freqgen/feeltech";

const fy = await connectNode();               // auto-detects the USB adapter
await fy.applyStep(Channel.Main, {
  waveform: "sine",
  frequencyHz: 1000,
  amplitudeVpp: 3.3,
  output: true,
});
await fy.close();
```

`applyStep` is the portable call: it takes the same `ChannelStep` on every
driver, so the code above works unchanged against a JDS6600 or an XM. Devices
with a required command ordering — the Gen X in particular, where a bare
frequency write produces no output at all — implement it as their native
sequence rather than as a loop of setters.

Driving an unknown generic device is just as portable:

```ts
import type { SignalGenerator } from "@freqgen/core";
import { runProgram } from "@freqgen/core";

async function play(gen: SignalGenerator) {
  await runProgram(gen, [
    { frequencyHz: 727.5, dwellSeconds: 180 },
    { frequencyHz: 880,   dwellSeconds: 180 },
  ], { repeat: 3 });
}
```

## Capabilities

Devices differ in ways that change behaviour, not just encoding, so ask before
sending a command that would be silently ignored:

```ts
const { perChannelOutput, outputRelay, dutyGatedByWaveform } = gen.capabilities;
```

- `outputRelay: false` — the FY3200S has no relay; on/off is emulated with amplitude.
- `perChannelOutput: false` — the MHS-5200A has one output switch for the whole device.
- `dutyGatedByWaveform` — the FY6900 ignores duty on waveform 1 (fixed 50 %).
- `requiresAuth` — the Gen X Pro gates physical output behind a challenge/response.
- `hardwareSync` — the XM can slave CH2's frequency to CH1 in the device.
- `readback` — the FY answers reads for every parameter, enabling verified writes.

Waveform requests report what the device will *actually* produce, rather than
swapping shapes silently:

```ts
await jds.setWaveform(0, "ramp-up");
// { requested: "ramp-up", actual: "triangle", substituted: true, code: 3 }
```

## Frequency limits and octave folding

Catalogue figures for these generators are quoted for *sine* output; square and
arbitrary bandwidth are lower and usually undocumented — and square is what
constrains most work. So limits carry their own provenance, and `null` means
unknown rather than unlimited:

```ts
import { resolveCap } from "@freqgen/core";

resolveCap(limits, "sine");    // { hz: 60_000_000, source: "spec" }
resolveCap(limits, "square");  // { hz: 60_000_000, source: "assumed-sine" }
```

For frequency sets outside a device's band, `foldToBand()` applies the Rife-style
convention of shifting by whole octaves:

```ts
import { foldToBand } from "@freqgen/core";

foldToBand(20e6, { hiHz: 2.5e6 });   // { hz: 2_500_000, octaves: -3 }
```

## Development

```bash
npm install          # installs every workspace
npm run typecheck
npm run build
npm test
```

## License

MIT — see [LICENSE](LICENSE).
