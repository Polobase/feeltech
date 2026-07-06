import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildCommand,
  cleanResponse,
  decodeAmplitudeV,
  decodeBool,
  decodeCounterDutyPct,
  decodeDutyPct,
  decodeFrequencyHz,
  decodeInt,
  decodeOffsetV,
  decodePhaseDeg,
  encodeAmplitudeV,
  encodeDutyPct,
  encodeFrequencyHz,
  encodeOffsetV,
  encodePhaseDeg,
  padInt,
} from "../src/protocol.js";

describe("frequency encoding", () => {
  it("FY2300 encodes 14-digit µHz", () => {
    assert.equal(encodeFrequencyHz("FY2300", 10_000), "00010000000000");
    assert.equal(encodeFrequencyHz("FY2300", 0.5), "00000000500000");
  });

  it("FY6900 encodes %015.6f Hz", () => {
    assert.equal(encodeFrequencyHz("FY6900", 10_000), "00010000.000000");
    assert.equal(encodeFrequencyHz("FY6900", 1000), "00001000.000000");
    assert.equal(encodeFrequencyHz("FY6900", 0.1), "00000000.100000");
    assert.equal(encodeFrequencyHz("FY6900", 60_000_000), "60000000.000000");
  });

  it("explicit encoding overrides the family default (old FY6900 firmware)", () => {
    assert.equal(encodeFrequencyHz("FY6900", 10_000, "uHz"), "00010000000000");
    assert.equal(encodeFrequencyHz("FY2300", 10_000, "hz"), "00010000.000000");
  });

  it("decodes per family", () => {
    assert.equal(decodeFrequencyHz("FY2300", "0000010000"), 10_000);
    assert.equal(decodeFrequencyHz("FY6900", "00010000.000000"), 10_000);
    assert.equal(decodeFrequencyHz("FY6900", "00000000.100000"), 0.1);
  });
});

describe("amplitude", () => {
  it("encodes 2 decimals (FY2300) / 4 decimals (FY6900)", () => {
    assert.equal(encodeAmplitudeV("FY2300", 3.3), "3.30");
    assert.equal(encodeAmplitudeV("FY6900", 3.3), "3.3000");
  });

  it("decodes /100 (FY2300) and the empirical /10000 (FY6900)", () => {
    assert.equal(decodeAmplitudeV("FY2300", "330"), 3.3);
    // Verified on FY6300-60M: 3.3 V reads back as "33000".
    assert.equal(decodeAmplitudeV("FY6900", "33000"), 3.3);
    assert.equal(decodeAmplitudeV("FY6900", "10000"), 1);
    assert.equal(decodeAmplitudeV("FY6900", "1000"), 0.1);
  });
});

describe("offset", () => {
  it("encodes signed decimals", () => {
    assert.equal(encodeOffsetV("FY2300", -1.5), "-1.50");
    assert.equal(encodeOffsetV("FY6900", -2.351), "-2.351");
  });

  it("decodes FY2300 bias-1000", () => {
    assert.equal(decodeOffsetV("FY2300", "1000"), 0);
    assert.equal(decodeOffsetV("FY2300", "1100"), 1);
    assert.equal(decodeOffsetV("FY2300", "999"), -0.01);
    assert.equal(decodeOffsetV("FY2300", "900"), -1);
  });

  it("decodes FY6900 two's-complement /1000", () => {
    assert.equal(decodeOffsetV("FY6900", "1234"), 1.234);
    // Verified on FY6300-60M: −1.234 V reads back as 2^32 − 1234.
    assert.equal(decodeOffsetV("FY6900", "4294966062"), -1.234);
    assert.equal(decodeOffsetV("FY6900", "0"), 0);
  });
});

describe("duty cycle", () => {
  it("channel duty decodes per family", () => {
    assert.equal(decodeDutyPct("FY2300", "689"), 68.9);
    assert.equal(decodeDutyPct("FY6900", "50000"), 50);
    assert.equal(decodeDutyPct("FY6900", "25000"), 25);
  });

  it("counter duty (RCD) is /10 on all families", () => {
    assert.equal(decodeCounterDutyPct("250"), 25);
    assert.equal(decodeCounterDutyPct("668"), 66.8);
  });

  it("encodes with 1 decimal", () => {
    assert.equal(encodeDutyPct(25), "25.0");
    assert.equal(encodeDutyPct(68.9), "68.9");
  });
});

describe("phase", () => {
  it("encodes integer (FY2300) / 3 decimals (FY6900)", () => {
    assert.equal(encodePhaseDeg("FY2300", 90.6), "91");
    assert.equal(encodePhaseDeg("FY6900", 90), "90.000");
  });

  it("decodes integer (FY2300) / ÷1000 (FY6900)", () => {
    assert.equal(decodePhaseDeg("FY2300", "90"), 90);
    assert.equal(decodePhaseDeg("FY6900", "90000"), 90);
  });
});

describe("misc helpers", () => {
  it("decodeBool treats 0-ish as false, everything else as true", () => {
    assert.equal(decodeBool("0"), false);
    assert.equal(decodeBool("0000000000"), false);
    assert.equal(decodeBool(""), false);
    assert.equal(decodeBool("1"), true);
    assert.equal(decodeBool("255"), true);
  });

  it("decodeInt strips whitespace and leading zeros", () => {
    assert.equal(decodeInt("0000000037\n"), 37);
  });

  it("padInt pads numbers and bigints", () => {
    assert.equal(padInt(42, 5), "00042");
    assert.equal(padInt(10_000_000_000n, 14), "00010000000000");
  });

  it("buildCommand appends the value and terminator", () => {
    assert.equal(buildCommand("WMF", "00001000.000000"), "WMF00001000.000000\n");
    assert.equal(buildCommand("WPF", 4), "WPF4\n");
    assert.equal(buildCommand("UMO"), "UMO\n");
  });

  it("cleanResponse strips trailing CR/LF and whitespace", () => {
    assert.equal(cleanResponse("value\r\n"), "value");
    assert.equal(cleanResponse("  value \n\n"), "value");
  });
});
