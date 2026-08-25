# @freqgen/juntek

TypeScript drivers for **JUNTEK** and **Koolertron** signal generators over USB
serial, in Node.js and the browser. Part of the [`@freqgen`](../../README.md#feature-matrix)
monorepo — see the main README for the device × capability feature matrix.

> ### ⚠️ Nothing here is hardware-verified
>
> Every driver implements a protocol documented by third-party reverse
> engineering. The tests assert conformance to that documentation, which is
> **not** the same as proving the documentation right. Each reports
> `capabilities.limits.verified === false`. **Confirm output with a scope.**

## Install

```bash
npm install @freqgen/juntek
```

## Devices

| Model | Brand | Driver | Protocol |
| --- | --- | --- | --- |
| JDS6600 | JUNTEK | `Jds6600` | 115200 8N1, `:w<reg>=<v>.` → `:ok` |
| JDS2800, JDS2900 | JUNTEK | `Jds6600` | as above |
| JDS8000 | JUNTEK | `Jds6600` | as above — least corroborated of the set |
| CJDS66 | Koolertron | `Jds6600` | as above — a rebadged JDS6600 |
| MHS-5200A | Koolertron | `Mhs5200a` | 57600 8N1, `:s<ch><letter><val>` → `ok` |

Both makes live in one package because Koolertron is a reseller rather than a
manufacturer: the CJDS66 is a rebadged JDS6600 speaking the same registers, and
the MHS-5200A is MHINSTEK/JUNTEK hardware. Splitting them by brand would put one
protocol in two packages and call the same device two things.

Protocol references: [`docs/jds6600-protocol.md`](docs/jds6600-protocol.md),
[`docs/mhs5200a-protocol.md`](docs/mhs5200a-protocol.md).

## Use

```ts
import { NodeSerialTransport } from "@freqgen/core/node";
import { Jds6600 } from "@freqgen/juntek";

const gen = new Jds6600(new NodeSerialTransport("/dev/cu.usbserial-1120"), {
  model: "CJDS66",   // only changes the reported label
});
await gen.open();
await gen.applyStep(0, {
  waveform: "square",
  frequencyHz: 1000,
  amplitudeVpp: 5,
  output: true,
});
await gen.close();
```

## CLI

```bash
npx @freqgen/juntek devices        # models + verification status
npx @freqgen/juntek list           # serial ports
npx @freqgen/juntek set --device jds6600 --port /dev/cu.usbserial-1120 \
    --waveform square --freq 1000 --amp 5 --on
```

## Three things worth knowing

**The JDS6600's output register carries both channels.** `:w20=<ch1>,<ch2>.` is
one write, so the driver tracks both states and re-sends the other channel's
value. Nothing else may change it behind the driver's back for that to stay
correct, which is why `close()` resets it to `0,0`.

**Slot 3 is a triangle on the JDS6600, a rising ramp on the MHS-5200A.** A
`ramp-up` request on the JDS6600 comes back `substituted: true` — a triangle is
not the asymmetric shape the Spooky2 contact shells want.

**The MHS-5200A's output switch is device-global.** `capabilities.perChannelOutput`
is `false`. The driver keeps per-channel intent and silences an unwanted channel
by writing 0 V, driving the hardware switch from whether either channel wants
output. It also pins the attenuator to 0 dB on connect so amplitude means volts.

## License

MIT
