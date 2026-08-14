# @freqgen/spooky2

TypeScript drivers for **Spooky2** signal generators — XM, Gen X and Gen X Pro —
over USB serial, in Node.js and the browser.

> ### ⚠️ Nothing here is hardware-verified
>
> Every driver in this package implements a protocol documented by third-party
> reverse engineering. Their tests assert conformance to that documentation,
> which is **not** the same as proving the documentation right. Each reports
> `capabilities.limits.verified === false`. **Confirm output with a scope.**

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

## Two things worth knowing before you start

**The Gen X cannot be driven parameter-by-parameter.** Writing a frequency and
expecting output does not work — the device needs its display text set, the
channel prepared, an arm sequence written, the frequency *ramped* up in steps,
and only then the amplitude. `applyStep()` does all of that. The individual
setters re-run the sequence rather than pretending to be independent.

**Gen X Pro output is gated behind a challenge/response handshake**, and this
package ships no response algorithm. The transform is unpublished, the
implementations in circulation were recovered by disassembling the vendor
application, and the lock exists precisely to keep third-party software from
driving the outputs — so distributing one here is not a decision this library
makes for you. Supply your own:

```ts
const pro = new GenXPro(transport, {
  authProvider: { respond: ({ nonce, v1, v2 }) => myTransform(nonce, v2) },
});
```

Without a provider the driver still connects, writes and reads registers;
`authenticated` stays `false` and the outputs stay dead.

## Unsupported parameters

The Gen X drivers accept `offsetV: 0`, `dutyCyclePct: 50` and `phaseDeg: 0` —
the neutral values every Spooky2 preset carries — and **throw** on anything
else, because no register is known for them. That is deliberate: silently
ignoring a duty-cycle request would run the wrong waveform without telling you.

For DC offset on the Gen X Pro specifically, registers 32 and 33 do carry the
value, but the only known way to latch them sits inside the stop sequence, and
writing them outside it has been observed to silence the output entirely.

## License

MIT
