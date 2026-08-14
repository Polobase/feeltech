# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-08-14

The library moved into a monorepo alongside a shared driver core and packages for
other generator makes, and **the package was renamed to `@freqgen/feeltech`**.

Apart from the name, the library stays source-compatible: every existing import,
method and CLI command works unchanged, and the `feeltech` binary keeps its name.
The only behavioural difference is `err.name` (see Changed).

### Migrating from `feeltech` 0.1.x

```bash
npm uninstall feeltech && npm install @freqgen/feeltech
```

```diff
- import { connectNode, Channel } from "feeltech";
+ import { connectNode, Channel } from "@freqgen/feeltech";
```

Subpath imports move with it: `feeltech/node` → `@freqgen/feeltech/node`, and the
same for `/web` and `/testing`. Nothing else changes.

### Added

- `FeelTech` now implements the vendor-neutral `SignalGenerator` interface from
  `@freqgen/core`, so code can drive an FY device and a Spooky2 generator
  through the same calls.
- `applyStep(channel, step)` — the portable form of `configureChannel()`. Emits
  byte-identical wire traffic; it exists so drivers with a required command
  ordering can implement the same call as their native sequence.
- `setWaveform()` accepts generic waveform kinds (`"sine"`, `"ramp-down"`,
  `"noise"`, …) alongside FY names and raw codes, and now **returns** an
  `AppliedWaveform` describing what the device will actually output. Kinds that
  previously threw (`"ramp-up"`, `"noise"`, `"square"` on the FY2300) now
  resolve; existing names and codes are unaffected.
- `capabilities` and `info` getters.
- `limitsForModel()` / `bandwidthFromModel()` — frequency limits read from the
  bandwidth marker the device reports in its model string (`FY6300-60M` →
  60 MHz sine). Square and arbitrary bandwidth stay `null`: they are lower than
  sine, undocumented, and guessing them would be worse than admitting ignorance.
- `traitsForModel()` — records the FY6900's duty gate (waveform 1 is fixed at
  50 %; duty only applies to waveform 2).
- `FY3200S` — driver for the older FY3200S/FY3224S dialect (9600 8N1, `b`/`d`
  channel prefix, lowercase commands, centihertz). These have no output relay,
  so `setOutput()` gates via amplitude and `capabilities.outputRelay` is `false`.
  Implemented from protocol documentation; not hardware-verified.
- `FEELTECH_DEVICES` registry descriptors.
- Vendor-neutral helpers re-exported for convenience: `foldToBand()`,
  `fitFrequencies()`, `resolveCap()`, `applyStepSequentially()`.

### Changed

- **`err.name` on thrown errors** now reads `"AwgError"`, `"AwgTimeoutError"`,
  `"AwgProtocolError"` or `"AwgVerifyError"` instead of the `FeelTech*` forms.
  The exported `FeelTechError` &c. are **aliases of those same classes**, not
  subclasses, so every `instanceof` check — in either direction — still holds.
  Only code that compares `err.name` as a string is affected.
- `FEELTECH_USB_FILTERS` now also covers CH341 and the dual-port CP2105/CP2108.
  It is a superset of the previous list, so nothing that matched before stops
  matching.
- The `Transport` implementations moved to `@freqgen/core`; `feeltech/node`
  and `feeltech/web` remain as entry points and re-export them. A hand-rolled
  `transport.open({ baudRate })` with no `stopBits` now defaults to 1 rather
  than 2 — `FeelTech.open()` has always set it explicitly per family, so
  connections made through the library are unaffected.

### Fixed

- `describeBridge()` no longer answers a vendor-only match with another
  product's table row, which claimed a product ID and `dualPort` flag the device
  never reported. An unrecognized model now returns its real IDs and says so.
- `findDevices()` no longer hides all but the first device behind a multi-port
  USB bridge. Deduplication of macOS's two-driver port names now keys on the
  interface rather than the USB location, which a multi-port bridge shares
  across independent devices. Confirmed against a Spooky2 Gen X Pro, whose two
  generators enumerate through one CH34x.
- Deduplication is applied on macOS only. Other platforms expose one node per
  interface already, so deduplicating there could only lose devices.
- A serial reply that arrives after its read timed out no longer answers the
  *next* command. All drivers now read through `readReply()`, which waits a
  grace period for the straggler and discards it. Found on a Gen X Pro, where a
  late `:err` spliced itself onto the following reply as `":err\r␀:r01=G2."`;
  the same hazard applies to any request/response device on a slow link.

## [0.1.1] — 2026-07-08

### Fixed

- `npx feeltech` works out of the box: `serialport` moved from an optional *peer* dependency (which npx never installs) to an **optional dependency**, so it is installed automatically for Node/CLI usage while staying out of browser bundles.
- `listPorts()`/`findDevices()` now raise the same friendly "serialport is not installed" `FeelTechError` as the transport instead of a raw `ERR_MODULE_NOT_FOUND`.

## [0.1.0] — 2026-07-06

First published release.

### Added

- High-level `FeelTech` client for FY-series generators (FY2300, FY6300, FY6600, FY6800, FY6900, FY8300): channel parameters, modulation (AM/FM/PM/ASK/FSK/PSK/Burst), sweeps, frequency counter / measurement, save/load slots, sync, cascade/uplink, buzzer, identity.
- Dual transports: Node.js (`serialport`, optional peer dependency) and browser Web Serial, selected via the `feeltech/node` and `feeltech/web` subpath exports.
- Arbitrary waveform upload (`DDS_WAVE`, 8192 × 14-bit) with `resampleWaveform()` / `normalizeWaveform()` helpers and `{ resample, normalize }` upload options.
- Device family auto-detection via `UMO`, with per-family wire encodings (frequency, amplitude, offset, duty, phase) verified against a real FY6300-60M.
- Serial-port auto-detection: `findDevices()` and path-less `connectNode()` (CH340/CP210x/PL2303 vendor IDs, macOS `cu.*` preference and duplicate-driver dedupe).
- `feeltech` CLI (`list`, `info`, `set`, `sweep`, `measure`, `waveforms`, `upload`) with `--json` output and port auto-detection — zero runtime dependencies.
- `MockTransport` test double under `feeltech/testing`, reproducing real response framing including the binary upload flow.
- `frequencyEncoding: "hz" | "uHz"` option for older FY6900 firmware that expects µHz frequency values.
- Parameter validation (channel, duty, phase, frequency, amplitude, burst count, memory/arb slots) throwing typed `FeelTechError`s.
- Verified writes: every parameter setter reads the value back and retries dropped writes (FY firmware occasionally acks without applying, e.g. after sweep/sync/uplink commands); throws `FeelTechVerifyError` if the device never applies the value. Configurable via `verifyWrites` (default on) and `writeRetries`.
- Unit test suite (node:test) and GitHub Actions CI (Node 20/22/24, publint + arethetypeswrong package checks).
- Runnable examples for every feature area plus a browser control panel (`npm run example:web`) and a hardware smoke test (`npm run test:hw`).

### Fixed

- FY6900-family offset sweeps now apply the firmware's required +10 V bias to `SST`/`SEN` values.
- The frequency counter's duty cycle (`RCD`) is decoded as ÷10 on all families (previously used the FY6900 channel scale ÷1000).
- Modulation examples sent the wrong mode codes (e.g. FSK instead of AM); they now use the `ModulationMode` constants.
- Exported enums are `as const` objects instead of `const enum`s, fixing consumption under `isolatedModules` (Vite/esbuild/swc) and Node type stripping.
- Full-scale arbitrary waveform samples now map exactly to the 14-bit maximum (16383).
- Transports default to 2 stop bits (FY6900-family requirement) when used directly.

[0.1.1]: https://github.com/Polobase/feeltech/releases/tag/v0.1.1
[0.1.0]: https://github.com/Polobase/feeltech/releases/tag/v0.1.0
