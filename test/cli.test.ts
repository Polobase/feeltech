import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseChannel, parseCliArgs, parseWaveformFile } from "../src/cli.js";
import { Channel, FeelTechError } from "../src/index.js";

describe("parseCliArgs", () => {
  it("routes subcommands with their options", () => {
    const parsed = parseCliArgs([
      "set",
      "--channel",
      "2",
      "--waveform",
      "sine",
      "--freq",
      "1000",
      "--on",
    ]);
    assert.equal(parsed.command, "set");
    assert.equal(parsed.values["channel"], "2");
    assert.equal(parsed.values["waveform"], "sine");
    assert.equal(parsed.values["freq"], "1000");
    assert.equal(parsed.values["on"], true);
  });

  it("accepts global options on any command", () => {
    const parsed = parseCliArgs(["info", "--port", "/dev/cu.x", "--json", "--debug"]);
    assert.equal(parsed.values["port"], "/dev/cu.x");
    assert.equal(parsed.values["json"], true);
    assert.equal(parsed.values["debug"], true);
  });

  it("maps no args / help to the help command", () => {
    assert.equal(parseCliArgs([]).command, "help");
    assert.equal(parseCliArgs(["--help"]).command, "help");
    assert.equal(parseCliArgs(["help"]).command, "help");
  });

  it("rejects unknown commands and unknown flags", () => {
    assert.throws(() => parseCliArgs(["frobnicate"]), FeelTechError);
    assert.throws(() => parseCliArgs(["info", "--bogus"]), FeelTechError);
  });

  it("rejects --on together with --off", () => {
    assert.throws(() => parseCliArgs(["set", "--on", "--off"]), FeelTechError);
  });
});

describe("parseChannel", () => {
  it("maps 1/2 to Main/Aux, defaulting to Main", () => {
    assert.equal(parseChannel("1"), Channel.Main);
    assert.equal(parseChannel("2"), Channel.Aux);
    assert.equal(parseChannel(undefined), Channel.Main);
  });

  it("rejects anything else", () => {
    assert.throws(() => parseChannel("3"), FeelTechError);
    assert.throws(() => parseChannel("main"), FeelTechError);
  });
});

describe("parseWaveformFile", () => {
  it("parses a JSON array", () => {
    assert.deepEqual(parseWaveformFile("[0, 0.5, 1]"), [0, 0.5, 1]);
  });

  it("parses one value per line, skipping blanks and # comments", () => {
    assert.deepEqual(parseWaveformFile("# header\n0\n0.5\n\n1\n"), [0, 0.5, 1]);
  });

  it("rejects empty or non-numeric content", () => {
    assert.throws(() => parseWaveformFile(""), FeelTechError);
    assert.throws(() => parseWaveformFile("[]"), FeelTechError);
    assert.throws(() => parseWaveformFile("abc\n1\n"), FeelTechError);
  });
});
