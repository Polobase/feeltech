# feeltech

A comprehensive TypeScript library for controlling **FeelTech / FeelElec FY-series arbitrary waveform generators** — FY2300, FY6300, FY6600, FY6800, FY6900, FY8300 — over USB serial.

Works in **Node.js** (via [`serialport`](https://serialport.io)) and in **browsers** (via the [Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API)) from a single source tree.

The protocol implementation has been verified empirically against a real **FY6300-60M** and follows the [`fygen`](https://github.com/mattwach/fygen) reference library on the points where the official FeelTech PDFs are wrong (and they are wrong about several scaling factors — see [`docs/serial_protocol.md`](docs/serial_protocol.md)).

---

## Features

- **Dual environment.** Same TypeScript API in Node and the browser. Per-environment transports are dynamically imported, so browser bundlers won't pull in `serialport`.
- **Full command coverage** — channel parameters, modulation (AM/FM/PM/ASK/FSK/PSK/Burst), sweep, frequency counter / pulse-width measurement, save/load slots, sync, cascade, identity.
- **Arbitrary waveform upload** — upload custom waveforms to device memory (14-bit, 8192 samples per waveform).
- **Auto-detection** of the device family (FY2300 vs. FY6300/6900 family) by querying `UMO`. Encoding/decoding is automatically chosen for the detected family.
- **Robust framing** with retry logic — handles trailing empty newlines, slow responses, and timing quirks transparently.
- **Strict types.** Every command is typed; channel state and measurement results are exposed as plain TypeScript interfaces.
- **No build step required for the library** — ships pre-built ESM with `.d.ts` files.

---

## Installation

```bash
pnpm add feeltech
# or
npm install feeltech
```

For Node.js, also install the optional peer dependency:

```bash
pnpm add serialport
```

`serialport` is **not** required in the browser (the bundler will see the `browser` field in `package.json` and replace it with `false`).

---

## Quick start

### Node.js

```ts
import { connectNode, Channel } from "feeltech";

const fy = await connectNode("/dev/cu.wchusbserial110");
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

---

## Listing serial ports (Node)

```ts
import { listPorts } from "feeltech/node";

for (const p of await listPorts()) {
  console.log(p.path, p.manufacturer, `${p.vendorId}:${p.productId}`);
}
```

FeelTech generators usually appear as a CH340 USB UART (vendor `1a86`, product `7523`) on macOS as `/dev/cu.wchusbserial*`, on Linux as `/dev/ttyUSB*`, and on Windows as `COMx`.

---

## API overview

### Connection

| Helper | Description |
|---|---|
| `connectNode(path, options?)` | Opens a Node `serialport` and returns an open `FeelTech`. |
| `connectWeb(options?)` | Browser-only; calls `navigator.serial.requestPort()` then opens it. |
| `new FeelTech(transport, options?)` | Inject your own `Transport` (e.g. for testing). |

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

## Constructor options

```ts
const fy = await connectNode("/dev/cu.wchusbserial110", {
  family: "FY6900",       // override auto-detection ("FY2300" | "FY6900" | "Unknown")
  baudRate: 115200,       // override family default
  readTimeoutMs: 1500,    // per-read timeout
  readRetries: 2,         // retries on no-response
  commandDelayMs: 0,      // pause after every command
  debug: true,            // log every TX/RX line
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

The repo includes runnable examples organized by topic:

### Basic examples

| Script | Description |
|---|---|
| `pnpm example:simple /dev/tty.wchusbserial110` | Minimalist: 1 kHz square wave |
| `pnpm example:basic /dev/tty.wchusbserial110` | Sine wave with 2-second output |
| `pnpm example:info /dev/tty.wchusbserial110` | Probe model, ID, and both channel states |
| `pnpm example:allwaves /dev/tty.wchusbserial110` | Cycle through all waveforms |
| `pnpm example:list` | List all serial ports |

### Modulation examples

| Script | Description |
|---|---|
| `pnpm example:mod:am /dev/tty.wchusbserial110` | AM modulation: 2 kHz + 150 Hz |
| `pnpm example:mod:fm /dev/tty.wchusbserial110` | FM modulation: 2 kHz + 150 Hz |
| `pnpm example:mod:pm /dev/tty.wchusbserial110` | PM modulation: 1 kHz + 500 Hz |
| `pnpm example:mod:fsk /dev/tty.wchusbserial110` | FSK: toggle between 1/2 kHz |
| `pnpm example:mod:psk /dev/tty.wchusbserial110` | PSK: phase-shift keying |
| `pnpm example:mod:burst /dev/tty.wchusbserial110` | Burst mode: N cycles per trigger |

### Sweep examples

| Script | Description |
|---|---|
| `pnpm example:sweep:freq /dev/tty.wchusbserial110` | Frequency sweep |
| `pnpm example:sweep:amp /dev/tty.wchusbserial110` | Amplitude sweep |
| `pnpm example:sweep:offset /dev/tty.wchusbserial110` | Offset sweep |
| `pnpm example:sweep:duty /dev/tty.wchusbserial110` | Duty cycle sweep |

### Measurement examples

| Script | Description |
|---|---|
| `pnpm example:measure /dev/tty.wchusbserial110` | Read frequency counter |
| `pnpm example:counter /dev/tty.wchusbserial110` | Count pulses for 10 seconds |
| `pnpm example:calibrate /dev/tty.wchusbserial110` | Inspect raw responses |
| `pnpm example:roundtrip /dev/tty.wchusbserial110` | Verify write→read accuracy |

### Arbitrary waveform examples

| Script | Description |
|---|---|
| `pnpm example:arb /dev/tty.wchusbserial110` | Upload and play a stairstep |
| `pnpm example:star /dev/tty.wchusbserial110` | XY star plot (oscilloscope XY mode) |
| `pnpm example:gcode /dev/tty.wchusbserial110 examples/gcode/star.gcd` | XY plot from G-code |

### System & debug examples

| Script | Description |
|---|---|
| `pnpm example:system /dev/tty.wchusbserial110` | Buzzer, uplink, sync, save/load |
| `pnpm example:debug /dev/tty.wchusbserial110` | Wire-level debug with hex dumps |
| `pnpm example:raw:cmd /dev/tty.wchusbserial110` | Send individual commands |
| `pnpm example:raw:bytes /dev/tty.wchusbserial110` | Raw byte-level protocol |
| `pnpm example:raw:dump /dev/tty.wchusbserial110` | Hex-print all responses |

### Demo mode

```bash
pnpm example:demo /dev/tty.wchusbserial110
```

Continuously cycles through waveforms, sweeps, modulation, and arbitrary waveforms for demonstration purposes. Press **Ctrl+C** to stop.

### Browser example

Open `examples/web/basic.html` in Chrome/Edge after running `pnpm build`.

---

## Architecture

```
src/
├── index.ts          # public exports + connectNode()/connectWeb() helpers
├── feeltech.ts       # high-level FeelTech device class
├── protocol.ts       # encode/decode helpers (per family)
├── waveforms.ts      # waveform tables & resolver
├── transport.ts      # Transport interface + LineBuffer
├── transports/
│   ├── node.ts       # NodeSerialTransport (uses serialport)
│   └── web.ts        # WebSerialTransport (uses navigator.serial)
└── types.ts          # enums, error classes, result types

examples/
├── basic/            # simple, info, list_ports, all_waves, sine_wave
├── modulation/       # am, fm, pm, fsk, psk, burst
├── sweep/            # sweep_frequency, sweep_amplitude, sweep_offset, sweep_duty
├── measurement/      # measure, counter, calibrate, roundtrip
├── arb/              # simple_arb, xy_star_plot, xy_gcode_plot
├── system/           # settings
├── lowlevel/         # debug, raw_commands, raw_bytes, raw_dump, raw_init_variations
├── gcode/            # sample .gcd files (star, cat)
└── web/              # basic.html (Web Serial demo)
```

The `Transport` interface is intentionally minimal (`open`, `write`, `readLine`, `flush`, `close`). You can plug in a mock transport in tests, or wrap a TCP-to-serial bridge.

---

## Protocol reference

A full protocol reference, derived from the official FeelTech PDFs and corrected against real-device measurements, lives in [`docs/serial_protocol.md`](docs/serial_protocol.md). It covers every command, the exact byte framing, parameter encoding, model differences, and known firmware quirks.

---

## Troubleshooting

**`Failed to open <path>`** — On macOS use `/dev/cu.wchusbserial*` (not `/dev/tty.wchusbserial*`); on Linux check `dmesg | tail` after plugging in to find the device, and ensure your user is in the `dialout` group.

**Garbled / shifted readings** — The library handles trailing empty newlines and retry logic automatically. If you bypass `sendRead` and read the port directly, drain the trailing empties yourself.

**Reads time out on FY6900** — Ensure the transport is opened with **2 stop bits**. The library does this automatically when family is `FY6900`/`Unknown` but not if you override `family: "FY2300"` on a 6900-series device.

**Web Serial: "No port selected"** — `navigator.serial.requestPort()` must be called from a user gesture (click handler).

---

## License

MIT © Manuel Haller Polo

Based on protocol research from the [`fygen`](https://github.com/mattwach/fygen) project (LGPL-2.1) by Matt Wach. This library is a clean-room TypeScript implementation; only the protocol semantics are derived from `fygen`.
