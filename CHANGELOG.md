# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/mahapo/feeltech/releases/tag/v0.1.0
