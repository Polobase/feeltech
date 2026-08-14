# freqgen

TypeScript drivers for USB-serial signal / frequency generators, sharing one
transport and driver core. Same API in **Node.js** (via `serialport`) and in
**browsers** (via the Web Serial API), from a single source tree.

## Packages

| Package | Directory | What it drives |
| --- | --- | --- |
| `@freqgen/core` | [`packages/core`](packages/core) | Shared transports, `SignalGenerator`, capabilities, limits, octave folding |
| `@freqgen/feeltech` | [`packages/feeltech`](packages/feeltech) | FeelTech / FeelElec FY-series |
| `@freqgen/juntek` | [`packages/juntek`](packages/juntek) | JUNTEK JDS-series and Koolertron |
| `@freqgen/spooky2` | [`packages/spooky2`](packages/spooky2) | Spooky2 XM, Gen X, Gen X Pro |

## Device support

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
| Gen X Pro | spooky2 | `GenXPro` | as above + arm/ramp sequence | ⚠️ output gated behind auth |
| Gen X Pro ×2 | spooky2 | `GenXPair` | two ports, one generator each | ⚠️ |

**✅ hardware** — verified against a real device.
**◐ partial** — the protocol is verified, this particular model is not.
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

## Capabilities

Devices differ in ways that change behaviour, not just encoding, so ask before
sending a command that would be silently ignored:

```ts
const { perChannelOutput, outputRelay, dutyGatedByWaveform } = gen.capabilities;
```

- `outputRelay: false` — the FY3200S has no relay; on/off is emulated with amplitude.
- `perChannelOutput: false` — the MHS-5200A has one output switch for the whole device.
- `dutyGatedByWaveform` — the FY6900 ignores duty on waveform 1 (fixed 50 %).
- `requiresFrequencyRamp` — the Gen X emits nothing if you jump straight to a target.

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
