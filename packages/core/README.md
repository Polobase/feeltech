# @freqgen/core

Shared core for USB-serial arbitrary waveform generator drivers.

This package holds what every driver needs and no protocol of its own:

- **Transports** — `NodeSerialTransport` (via `serialport`) and
  `WebSerialTransport` (via the Web Serial API), behind one `Transport`
  interface, plus the `LineBuffer` that turns byte chunks into lines.
- **`SignalGenerator`** — the driver contract, with both fine-grained setters
  and `applyStep()` for devices that require a specific ordering.
- **`Capabilities`** — what a device can actually do, so callers can adapt
  before sending a command that would be silently ignored.
- **`FrequencyLimits`** — limits *and* how well established they are. `null`
  means unknown, and unknown is never replaced with a guess.
- **Octave folding** — `foldToBand()` / `fitFrequencies()`, the Rife-style
  convention of shifting an out-of-band frequency by whole octaves.
- **`RecordingTransport`** — records written bytes and replays scripted
  responses, for wire-transcript tests.

- **`runProgram`** — play a frequency program (steps with dwell times, repeat
  count, abort signal) on any `SignalGenerator`.

You normally install a vendor package instead:

| Package | Devices |
| --- | --- |
| [`@freqgen/feeltech`](../feeltech) | FeelTech / FeelElec FY2300, FY6300, FY6600, FY6800, FY6900, FY8300, FY3200S |
| [`@freqgen/juntek`](../juntek) | JUNTEK JDS6600/2800/2900/8000, Koolertron CJDS66 & MHS-5200A |
| [`@freqgen/spooky2`](../spooky2) | Spooky2 XM, Gen X, Gen X Pro |

Reach for this package directly when you want to treat several generators
interchangeably. The [monorepo README](../../README.md#feature-matrix) has the
full device × capability feature matrix.

## License

MIT
