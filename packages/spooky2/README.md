# @freqgen/spooky2

TypeScript drivers for **Spooky2** signal generators — XM, Gen X and Gen X Pro —
over USB serial, in Node.js and the browser.

> ### ⚠️ Output is not hardware-verified
>
> These drivers implement protocols documented by third-party reverse
> engineering. Their tests assert conformance to that documentation, which is
> **not** the same as proving the documentation right. Each reports
> `capabilities.limits.verified === false`. **Confirm output with a scope.**
>
> The Gen X Pro driver's *link layer* has been checked against a real unit
> (firmware 200): connecting, identity readback, the lock state and the
> challenge exchange all behave as documented. Nothing past the lock could be
> tested, because a locked unit rejects every register write.

## Install

```bash
npm install @freqgen/spooky2
```

## Use

```ts
import { NodeSerialTransport } from "@freqgen/core/node";
import { Spooky2XM } from "@freqgen/spooky2";

const xm = new Spooky2XM(new NodeSerialTransport("/dev/cu.usbserial-1120"));
await xm.open();
await xm.applyStep(0, {
  waveform: "square",
  frequencyHz: 727.5,
  amplitudeVpp: 20,
  output: true,
});
await xm.close();
```

## CLI

```bash
npx @freqgen/spooky2 devices                 # drivers + verification status
npx @freqgen/spooky2 list                    # serial ports
npx @freqgen/spooky2 set --device xm --port /dev/cu.usbserial-1120 \
    --waveform square --freq 727.5 --amp 20 --on
```

## Devices

| Driver | Device | Protocol | Notes |
| --- | --- | --- | --- |
| `Spooky2XM` | XM | 57600 8N1, `:w<reg><val>` + `ok` | Sawtooth slot direction unconfirmed |
| `GenXClassic` | Gen X (classic) | 115200 8N1, `:w<reg>=<a>,<b>,` | Experimental; audio/RF boundary is a default, not a measurement |
| `GenXPro` | Gen X Pro | as above, plus an arm/ramp sequence | Output gated behind authentication — see below |
| `GenXPair` | two Gen X Pros | two ports, one per unit | The Pro's dual-port bridge exposes each generator separately |

Protocol references: [`docs/xm-protocol.md`](docs/xm-protocol.md),
[`docs/genx-protocol.md`](docs/genx-protocol.md).

## The register map is the vendor's own

The Gen X Pro driver was rebuilt on the register assignments Spooky2's own
application prints in its debug strings (`:w24` = "Out 1 Frequency", `:w28` =
"Out 1 Amplitude", …) — see [`docs/spooky2-command-set.md`](docs/spooky2-command-set.md).
That map was cross-checked on a real Gen X Pro: with the output running, stepping
`:w28` moved the device's own biofeedback current sensor and stepping `:w17` did
not, confirming `:w28` is amplitude.

It replaced an earlier third-party map that treated `:w28`/`:w29` as a frequency
"ramp" and needed an elaborate arm-and-ramp sequence to get output. That
sequence was really ramping the *amplitude* up from zero. **The Gen X drives
like any register device** — plain writes, no ramp — so `applyStep()` is now the
ordinary sequential application, and `capabilities.requiresFrequencyRamp` is
`false`.

The *scale factors* (counts per hertz, per volt) are not yet scope-confirmed;
the driver uses XM-analogous defaults and marks them in code.

### Beyond the basics

The Gen X Pro exposes the per-output functions Spooky2 shells use, all from the
vendor labels: `setGating`, `setModulation`, `setSync`, `setInversion`,
`setLowFrequencyMode`, `calibrate` and `reset`.

## Gen X Pro output is gated behind a handshake

The outputs accept writes and reads only after a register-92 challenge/response
succeeds. `GenXPro` authenticates automatically with a bundled provider
({@link GENX_AUTH_PROVIDER}), confirmed working on real hardware, so a Pro you
own drives out of the box:

```ts
const pro = new GenXPro(transport);   // authenticates on open()
```

The response transform is an interoperability key for the device — a small
arithmetic function that lets your own hardware talk to non-vendor software. To
use a different one, or none:

```ts
new GenXPro(transport, { authProvider: myProvider }); // override
new GenXPro(transport, { authProvider: null });       // disable; outputs stay gated
```

## Waveform tables

`SPOOKY2_WAVEFORMS` ships the eleven real Spooky2 waveform sample tables (sine,
square, sawtooth, inverted sawtooth, triangle, the damped pair, the H-bomb pair,
and two user-defined slots), taken verbatim from the vendor's `Waveforms.csv` at
1024 samples each, normalised to −1…+1.

Live waveform selection (`setWaveform`) covers the built-in sine and square; the
other Spooky2 shapes are uploaded sample tables, and the upload path is not yet
implemented. See [`docs/genx-capabilities.md`](docs/genx-capabilities.md) for the
full capability/gap analysis.

## Biofeedback

The Gen X Pro's high-side detector reads output current and phase angle, live:

```ts
const { current, phaseAngle } = await pro.readBiofeedback(); // raw detector counts
```

Confirmed reading live values on hardware. The raw counts are directly usable for
a biofeedback *scan* (sweep frequency, find where the response peaks); the
absolute conversion to amps/degrees is not yet calibrated.

## Running a program

A frequency program — a list of steps with dwell times — runs on any driver via
`runProgram()` from `@freqgen/core`:

```ts
import { runProgram } from "@freqgen/core";

await runProgram(xm, [
  { frequencyHz: 727.5, dwellSeconds: 180 },
  { frequencyHz: 787,   dwellSeconds: 180 },
  { frequencyHz: 880,   dwellSeconds: 180 },
], { repeat: 3, signal: abortController.signal });
```

## Unsupported parameters

Duty cycle has no register on the Gen X, so the drivers accept `dutyCyclePct: 50`
(the neutral every preset carries) and **throw** on anything else rather than
silently running the wrong shape. On the Gen X Pro, Out 1 also has no phase
register — phase is set on Out 2 relative to Out 1.

## License

MIT
