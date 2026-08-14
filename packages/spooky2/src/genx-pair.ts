/**
 * Two Gen X Pro units driven as one two-channel generator.
 *
 * The Pro enumerates over a dual-port USB bridge (CP2105), and each port is an
 * *independent generator* rather than a second channel of one device. So a
 * "two-channel Gen X Pro" is really two drivers, each with its own transport,
 * its own authentication and its own step sequence.
 *
 * **Verification status: unverified**, like the underlying driver.
 */

import {
  AwgError,
  DEFAULT_CAPABILITIES,
  type AppliedWaveform,
  type Capabilities,
  type ChannelStep,
  type DeviceInfo,
  type SignalGenerator,
  type WaveformKind,
} from "@freqgen/core";

import { GenXPro } from "./genx-pro.js";

export class GenXPair implements SignalGenerator {
  readonly info: DeviceInfo = { vendor: "Spooky2", model: "Gen X Pro (paired)" };

  /**
   * @param units Exactly two generators, in the order their ports were opened.
   * @param identities What each unit reports as its own identity (`:r01=`),
   *   when known. Used to map logical channels onto ports — see
   *   {@link GenXPair.unitForChannel} for why it is not trusted blindly.
   */
  constructor(
    private readonly units: readonly [GenXPro, GenXPro],
    private readonly identities: readonly [string | null, string | null] = [null, null],
  ) {}

  get capabilities(): Capabilities {
    const base = this.units[0].capabilities;
    return {
      ...DEFAULT_CAPABILITIES,
      ...base,
      channels: 2,
      // Each channel is a physically separate generator, so they switch
      // independently by construction.
      perChannelOutput: true,
    };
  }

  /** True only when every unit has authenticated. */
  get authenticated(): boolean {
    return this.units.every((u) => u.authenticated);
  }

  /**
   * Map a logical channel onto one of the two units.
   *
   * Self-reported identity is used **only when the two units disagree**. Both
   * ports of a pair have been observed reporting the same identity, and trusting
   * that blindly sends both logical channels to one unit and leaves the other
   * silent. Falling back to connection order at least guarantees each unit gets
   * exactly one channel.
   */
  unitForChannel(channel: number): GenXPro {
    assertChannel(channel);
    const [a, b] = this.identities;
    if (a !== null && b !== null && a !== b) {
      const match = this.units.find((_, i) => this.identities[i] === `G${channel + 1}`);
      if (match) return match;
    }
    return this.units[channel]!;
  }

  async open(): Promise<void> {
    for (const unit of this.units) await unit.open();
  }

  async close(): Promise<void> {
    for (const unit of this.units) {
      try {
        await unit.close();
      } catch {
        /* close the rest regardless */
      }
    }
  }

  /**
   * Each unit drives its own local channel 0 — from inside a port there is only
   * one generator, so the logical channel selects the *port*, not a channel
   * within it.
   */
  async applyStep(channel: number, step: ChannelStep): Promise<void> {
    await this.unitForChannel(channel).applyStep(0, step);
  }

  async setWaveform(
    channel: number,
    waveform: WaveformKind | number,
  ): Promise<AppliedWaveform> {
    return this.unitForChannel(channel).setWaveform(0, waveform);
  }

  async setFrequency(channel: number, hz: number): Promise<void> {
    await this.unitForChannel(channel).setFrequency(0, hz);
  }

  async setAmplitude(channel: number, volts: number): Promise<void> {
    await this.unitForChannel(channel).setAmplitude(0, volts);
  }

  async setOffset(channel: number, volts: number): Promise<void> {
    await this.unitForChannel(channel).setOffset(0, volts);
  }

  async setDutyCycle(channel: number, pct: number): Promise<void> {
    await this.unitForChannel(channel).setDutyCycle(0, pct);
  }

  async setPhase(channel: number, degrees: number): Promise<void> {
    await this.unitForChannel(channel).setPhase(0, degrees);
  }

  async setOutput(channel: number, enabled: boolean): Promise<void> {
    await this.unitForChannel(channel).setOutput(0, enabled);
  }

  /** Run the same step on both units — the mirrored "booster" configuration. */
  async applyStepToAll(step: ChannelStep): Promise<void> {
    await Promise.all(this.units.map((u) => u.applyStep(0, step)));
  }

  /** Stop output on both units. */
  async stopAll(): Promise<void> {
    await Promise.all(this.units.map((u) => u.stopOutput()));
  }
}

function assertChannel(channel: number): void {
  if (channel !== 0 && channel !== 1) {
    throw new AwgError(`Invalid channel ${channel} — a Gen X pair has channels 0 and 1`);
  }
}
