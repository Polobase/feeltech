# feeltech

[![CI](https://github.com/Polobase/feeltech/actions/workflows/ci.yml/badge.svg)](https://github.com/Polobase/feeltech/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/feeltech)](https://www.npmjs.com/package/feeltech)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A comprehensive TypeScript library **and CLI** for controlling **FeelTech / FeelElec FY-series arbitrary waveform generators** — FY2300, FY6300, FY6600, FY6800, FY6900, FY8300 — over USB serial.

Works in **Node.js** (via [`serialport`](https://serialport.io)) and in **browsers** (via the [Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API)) from a single source tree.

The protocol implementation has been verified empirically against a real **FY6300-60M** and follows the [`fygen`](https://github.com/mattwach/fygen) reference library on the points where the official FeelTech PDFs are wrong (and they are wrong about several scaling factors — see [`docs/serial_protocol.md`](docs/serial_protocol.md)).

---

## Features

- **Dual environment.** Same TypeScript API in Node and the browser. Per-environment transports are dynamically imported, so browser bundlers won't pull in `serialport`.
- **Full command coverage** — channel parameters, modulation (AM/FM/PM/ASK/FSK/PSK/Burst), sweep, frequency counter / pulse-width measurement, save/load slots, sync, cascade, identity.
- **Arbitrary waveform upload** — upload custom waveforms to device memory (14-bit, 8192 samples per waveform), with `resampleWaveform()`/`normalizeWaveform()` helpers for arbitrary-length data.
- **CLI included** — `npx feeltech list | info | set | sweep | measure | waveforms | upload`.
- **Port auto-detection** — `connectNode()` without a path finds the generator's USB serial adapter (CH340/CP210x/PL2303) automatically; the device path changing between USB ports stops mattering.
- **Auto-detection of the device family** (FY2300 vs. FY6300/6900 family) by querying `UMO`. Encoding/decoding is automatically chosen for the detected family.
- **Robust framing** with retry logic — handles trailing empty newlines, slow responses, and timing quirks transparently.
- **Verified writes.** FY firmware occasionally acks a write without applying it; every parameter setter reads the value back and retries automatically (opt out with `verifyWrites: false`).
- **Strict types.** Every command is typed; channel state and measurement results are exposed as plain TypeScript interfaces. Enums are `as const` objects, so the library works under `isolatedModules` and Node's type stripping.
- **Testable without hardware** — a `MockTransport` ships under `feeltech/testing`.
- **No build step required for the library** — ships pre-built ESM with `.d.ts` files.

---

## Installation

```bash
npm install feeltech
```

The Node serial backend ([`serialport`](https://serialport.io)) is an **optional dependency** — npm installs it automatically, so the library and the `npx feeltech` CLI work out of the box. If its native build ever fails on an exotic platform (or you install with `--omit=optional`), Node usage will tell you to `npm install serialport` explicitly.

`serialport` is **not** required in the browser (the bundler will see the `browser` field in `package.json` and replace it with `false`, and it never enters your bundle).

---

## Quick start

### Node.js

```ts
import { connectNode, Channel } from "feeltech";

const fy = await connectNode(); // no path: auto-detects the USB adapter
console.log("Connected to", fy.deviceModel, "(family:", fy.family, ")");

await fy.configureChannel(Channel.Main, {
  waveform: "Sine",
  frequencyHz: 1000,
  amplitudeV: 3.3,
  offsetV: 0,
  dutyCyclePct: 50,
  enabled: true,
});

console.log(await fy.getChannelState(Channel.Main));

await fy.setOutput(Channel.Main, false);
await fy.close();
```

You can also pass an explicit port: `connectNode("/dev/cu.wchusbserial1220")` or `connectNode("COM3")`.

### Browser (Web Serial API)

```ts
import { connectWeb, Channel, FEELTECH_USB_FILTERS } from "feeltech";

document.querySelector("#connect").addEventListener("click", async () => {
  const fy = await connectWeb({ filters: FEELTECH_USB_FILTERS });
  await fy.setWaveform(Channel.Main, "Sine");
  await fy.setFrequency(Channel.Main, 1000);
  await fy.setAmplitude(Channel.Main, 3.3);
  await fy.setOutput(Channel.Main, true);
});
```

The browser must support [Web Serial](https://caniuse.com/web-serial) (Chrome, Edge, Opera). Page must be served over HTTPS or `localhost`.

### CLI

```bash
npx feeltech list                    # list serial ports (* = FeelTech-likely)
npx feeltech info                    # model, ID, family, both channel states
npx feeltech set --channel 1 --waveform sine --freq 1000 --amp 3.3 --on
npx feeltech set --channel 1 --off
npx feeltech sweep --object freq --start 100 --end 10000 --time 5
npx feeltech sweep --stop
npx feeltech measure --gate 1
npx feeltech waveforms --channel 2
npx feeltech upload --slot 1 --file wave.json --resample --normalize
npx feeltech --help
```

The port is auto-detected; pass `--port /dev/cu.wchusbserial1220` (or `COMx`) to pin it. `--json` switches every command to machine-readable output.

---

## Finding the device (Node)

```ts
import { findDevices, listPorts } from "feeltech/node";

console.log(await findDevices()); // FeelTech-likely ports only (by USB vendor ID)
console.log(await listPorts());   // every serial port
```

FeelTech generators usually appear as a CH340 USB UART (vendor `1a86`, product `7523`) — on macOS as `/dev/cu.wchusbserial*`, on Linux as `/dev/ttyUSB*`, and on Windows as `COMx`. The numeric suffix changes when you plug into a different USB port, which is why auto-detection is the default.

---

## API overview

Channel numbering: the device's front panel says **CH1/CH2**; in code these are `Channel.Main` (0) and `Channel.Aux` (1).

### Connection

| Helper | Description |
|---|---|
| `connectNode(path?, options?)` | Opens a Node `serialport` (auto-detected when `path` is omitted) and returns an open `FeelTech`. |
| `connectWeb(options?)` | Browser-only; calls `navigator.serial.requestPort()` then opens it. |
| `new FeelTech(transport, options?)` | Inject your own `Transport` (e.g. `MockTransport` for testing). |

### Channel commands

```ts
await fy.setWaveform(Channel.Main, "Sine");          // by name
await fy.setWaveform(Channel.Main, 0);               // by code
await fy.setWaveform(Channel.Aux, "Arbitrary3");     // arbitrary slot

await fy.setFrequency(Channel.Main, 1_000_000);      // 1 MHz
await fy.setAmplitude(Channel.Main, 3.3);            // V
await fy.setOffset(Channel.Main, -1.5);              // V (signed)
await fy.setDutyCycle(Channel.Main, 25.0);           // %
await fy.setPhase(Channel.Main, 90.0);               // degrees
await fy.setOutput(Channel.Main, true);

const state = await fy.getChannelState(Channel.Main);
// → { waveform, waveformName, frequencyHz, amplitudeV, offsetV, dutyCyclePct, phaseDeg, enabled }
```

Out-of-range values (duty > 100 %, negative frequency, …) throw a `FeelTechError` instead of being sent to the device.

`configureChannel(channel, partial)` applies many fields in one call:

```ts
await fy.configureChannel(Channel.Main, {
  waveform: "Square",
  frequencyHz: 1e6,
  amplitudeV: 5,
  enabled: true,
});
```

### Modulation

```ts
import { ModulationMode, ModulationSource } from "feeltech";

await fy.setModulationMode(ModulationMode.AM);
await fy.setModulationSource(ModulationSource.CH2);
await fy.setAmModulationRate(50.0);     // 50%
await fy.setBurstCount(10);
await fy.manualTrigger();               // FY6900 only
```

### Sweep

```ts
import { SweepObject, SweepMode } from "feeltech";

await fy.configureSweep({
  object: SweepObject.Frequency,
  start: 100,
  end: 10_000,
  timeSeconds: 5,
  mode: SweepMode.Linear,
});
await fy.startSweep();
// ... later
await fy.stopSweep();
```

Offset sweeps on the FY6900 family need a +10 V bias on the wire (a firmware quirk); the library applies it automatically.

### Arbitrary waveform upload

```ts
const values = Array.from({ length: 8192 }, (_, i) => Math.sin(i * 0.001));
await fy.uploadWaveform(1, values, { minValue: -1, maxValue: 1 });

await fy.configureChannel(Channel.Main, {
  waveform: "Arbitrary1",
  frequencyHz: 1000,
  amplitudeV: 3,
  enabled: true,
});
```

`uploadWaveform` requires exactly 8192 samples — pass `{ resample: true }` to linearly resample arbitrary-length data, and/or `{ normalize: true }` to scale it into −1…+1. The standalone helpers are exported too:

```ts
import { resampleWaveform, normalizeWaveform } from "feeltech";

const samples = resampleWaveform(normalizeWaveform(rawData)); // → 8192 points, −1…+1
```

> **Note:** the upload implements the `DDS_WAVE` protocol with 8192 × 14-bit samples, as used by the FY6600/6800/6900/6300 family (verified on an FY6300-60M). The older FY2300-class 2048 × 16-bit upload variant is not implemented yet.

### Frequency counter / measurement

```ts
import { GateTime } from "feeltech";

await fy.setGateTime(GateTime.OneSecond);
await fy.resetCounter();
const m = await fy.readMeasurement();
// → { frequencyHz, count, periodNs, positivePulseNs, negativePulseNs, dutyCyclePct, gateTime }
```

### System settings

```ts
await fy.saveState(1);              // save to slot 1
await fy.loadState(1);              // load from slot 1
await fy.enableSync(SyncObject.Frequency);
await fy.setBuzzer(false);
await fy.readModel();               // "FY6300-60M"
await fy.readId();
```

### Low-level escape hatch

If you need a command that's not wrapped, send it directly:

```ts
await fy.sendWrite("WMW", "00");          // raw write
const raw = await fy.sendRead("RMF");     // raw read
```

---

## Testing your code without hardware

```ts
import { FeelTech } from "feeltech";
import { MockTransport } from "feeltech/testing";

const mock = new MockTransport({ family: "FY6900" });
const fy = new FeelTech(mock);
await fy.open();

await fy.setFrequency(0, 1000);
console.log(mock.writes); // ["…", "WMF00001000.000000\n"]
```

The mock reproduces the FY-series response framing (write acks, `<value>\n\n` reads, the `UMO` special case, and the `DDS_WAVE` binary upload flow), and remembers written values so reads round-trip.

---

## Constructor options

```ts
const fy = await connectNode(undefined, {
  family: "FY6900",         // override auto-detection ("FY2300" | "FY6900" | "Unknown")
  baudRate: 115200,         // override family default
  frequencyEncoding: "hz",  // "hz" | "uHz" — see Troubleshooting
  readTimeoutMs: 1500,      // per-read timeout
  readRetries: 2,           // retries on no-response
  verifyWrites: true,       // read setters back and retry dropped writes (default)
  writeRetries: 2,          // retries per verified write
  commandDelayMs: 0,        // pause after every command
  debug: true,              // log every TX/RX line
  logger: (m, ...a) => console.log("[fy]", m, ...a),
});
```

---

## Device family differences

| | FY2300 | FY6300 / FY6900 family |
|---|---|---|
| Baud rate | 9600 | 115200 |
| Stop bits | 1 | 2 |
| Write ack | none | `\n` |
| Read framing | `<value>\n` | `<value>\n\n` (UMO: `<value>\n\n\n\n`) |
| Frequency | 14-digit µHz integer | decimal Hz, format `%015.6f` |
| Amplitude scale | int / 100 | int / **10000** |
| Offset encoding | bias-1000 | signed 32-bit / 1000 |
| Duty scale | int / 10 | int / **1000** |
| Phase scale | int (deg) | int / **1000** |
| Built-in waveforms | 31 | 37 (CH1) / 36 (CH2) |
| Arbitrary slots | 16 | 64 |

The library handles all of this; your code stays the same regardless of family.

---

## Examples

The repo includes runnable examples organized by topic. `<port>` is optional everywhere — omit it to auto-detect (the `--` after the script name is required by npm).

### Basic examples

| Script | Description |
|---|---|
| `npm run example:simple -- <port>` | Minimalist: 1 kHz square wave |
| `npm run example:basic -- <port>` | Sine wave with 2-second output |
| `npm run example:info -- <port>` | Probe model, ID, and both channel states |
| `npm run example:allwaves -- <port>` | Cycle through all waveforms |
| `npm run example:list` | List all serial ports |

### Modulation examples

| Script | Description |
|---|---|
| `npm run example:mod:am -- <port>` | AM modulation: 2 kHz + 150 Hz |
| `npm run example:mod:fm -- <port>` | FM modulation: 2 kHz + 150 Hz |
| `npm run example:mod:pm -- <port>` | PM modulation: 1 kHz + 500 Hz |
| `npm run example:mod:fsk -- <port>` | FSK: toggle between 1/2 kHz |
| `npm run example:mod:psk -- <port>` | PSK: phase-shift keying |
| `npm run example:mod:burst -- <port>` | Burst mode: N cycles per trigger |

### Sweep examples

| Script | Description |
|---|---|
| `npm run example:sweep:freq -- <port>` | Frequency sweep |
| `npm run example:sweep:amp -- <port>` | Amplitude sweep |
| `npm run example:sweep:offset -- <port>` | Offset sweep |
| `npm run example:sweep:duty -- <port>` | Duty cycle sweep |

### Measurement examples

| Script | Description |
|---|---|
| `npm run example:measure -- <port>` | Read frequency counter |
| `npm run example:counter -- <port>` | Count pulses for 10 seconds |
| `npm run example:calibrate -- <port>` | Inspect raw responses |
| `npm run example:roundtrip -- <port>` | Verify write→read accuracy |

### Arbitrary waveform examples

| Script | Description |
|---|---|
| `npm run example:arb -- <port>` | Upload and play a stairstep |
| `npm run example:star -- <port>` | XY star plot (oscilloscope XY mode) |
| `npm run example:gcode -- <port> examples/gcode/star.gcd` | XY plot from G-code |

### System & debug examples

| Script | Description |
|---|---|
| `npm run example:system -- <port>` | Buzzer, uplink, sync, save/load |
| `npm run example:debug -- <port>` | Wire-level debug with hex dumps |
| `npm run example:raw:cmd -- <port>` | Send individual commands |
| `npm run example:raw:bytes -- <port>` | Raw byte-level protocol |
| `npm run example:raw:dump -- <port>` | Hex-print all responses |

### Demo mode

```bash
npm run example:demo -- <port>
```

Continuously cycles through waveforms, sweeps, modulation, and arbitrary waveforms for demonstration purposes. Press **Ctrl+C** to stop.

### Browser example (web control panel)

```bash
npm run example:web
```

This builds the library and serves the repo on `http://localhost:3000` — then open [http://localhost:3000/examples/web/basic.html](http://localhost:3000/examples/web/basic.html) in Chrome or Edge. (The page loads ES modules from `dist/`, which browsers block over `file://`, so it must be served — any static server on `localhost` works.)

---

## Hardware smoke test

With a generator connected you can run the protocol-quirk verification script (it briefly drives CH1 and restores a neutral state):

```bash
npm run test:hw -- /dev/cu.wchusbserial1220
```

---

## Architecture

```
src/
├── index.ts           # public exports + connectNode()/connectWeb() helpers
├── feeltech.ts        # high-level FeelTech device class
├── protocol.ts        # encode/decode helpers (per family)
├── waveforms.ts       # waveform tables & resolver
├── waveform-utils.ts  # resampleWaveform() / normalizeWaveform()
├── transport.ts       # Transport interface + LineBuffer
├── testing.ts         # MockTransport (exported as feeltech/testing)
├── cli.ts             # `feeltech` command-line tool
├── transports/
│   ├── node.ts        # NodeSerialTransport + listPorts()/findDevices()
│   └── web.ts         # WebSerialTransport (uses navigator.serial)
└── types.ts           # enums, error classes, result types

examples/
├── basic/            # simple, info, list_ports, all_waves, sine_wave
├── modulation/       # am, fm, pm, fsk, psk, burst
├── sweep/            # sweep_frequency, sweep_amplitude, sweep_offset, sweep_duty
├── measurement/      # measure, counter, calibrate, roundtrip
├── arb/              # simple_arb, xy_star_plot, xy_gcode_plot
├── system/           # settings
├── lowlevel/         # debug, raw_commands, raw_bytes, raw_dump, raw_init_variations
├── gcode/            # sample .gcd files (star, cat)
└── web/              # basic.html (Web Serial control panel)
```

The `Transport` interface is intentionally minimal (`open`, `write`, `readLine`, `flush`, `close`). You can plug in a mock transport in tests, or wrap a TCP-to-serial bridge.

---

## Protocol reference

A full protocol reference, derived from the official FeelTech PDFs and corrected against real-device measurements, lives in [`docs/serial_protocol.md`](docs/serial_protocol.md). It covers every command, the exact byte framing, parameter encoding, model differences, and known firmware quirks.

---

## Troubleshooting

**`No FeelTech-like USB serial adapter found`** — auto-detection matches USB vendor IDs `1a86` (CH340), `10c4` (CP210x) and `067b` (PL2303). If your adapter reports something else, pass the port path explicitly. Run `npx feeltech list` to see every port.

**`Failed to open <path>`** — On macOS use `/dev/cu.*` (not `/dev/tty.*`); on Linux check `dmesg | tail` after plugging in to find the device, and ensure your user is in the `dialout` group.

**Garbled / shifted readings** — The library handles trailing empty newlines and retry logic automatically. If you bypass `sendRead` and read the port directly, drain the trailing empties yourself.

**Reads time out on FY6900** — Ensure the transport is opened with **2 stop bits**. The library does this automatically when family is `FY6900`/`Unknown` but not if you override `family: "FY2300"` on a 6900-series device.

**FY6900 sets a wildly wrong frequency (off by ~10⁶)** — some older FY6900 firmware expects the frequency as a 14-digit µHz integer instead of decimal Hz. Pass `frequencyEncoding: "uHz"` in the options.

**`FeelTechVerifyError: … was not applied by the device`** — on some firmware (observed on the FY6300-60M) the device occasionally acks a write without applying it, especially right after sweep or sync-mode commands. The library retries automatically (`writeRetries`); this error means the value still didn't stick after all attempts — usually because the firmware clamped an out-of-range value (e.g. a frequency beyond the device's maximum). Pass `verifyWrites: false` to send writes blind. Note that save slots (`saveState`) snapshot the *applied* state, so pause briefly after parameter writes before saving.

**Web Serial: "No port selected"** — `navigator.serial.requestPort()` must be called from a user gesture (click handler).

---

## License

MIT © Manuel Haller Polo

Based on protocol research from the [`fygen`](https://github.com/mattwach/fygen) project (LGPL-2.1) by Matt Wach. This library is a clean-room TypeScript implementation; only the protocol semantics are derived from `fygen`.
