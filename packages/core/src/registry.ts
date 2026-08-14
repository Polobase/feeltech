/**
 * A registry of drivers, so an application can pick a generator by name.
 *
 * Vendor packages export descriptors; the application registers the ones it
 * wants. Registration is explicit rather than automatic because the alternative
 * — a core that imports every vendor package — would invert the dependency
 * direction and pull every driver into every bundle.
 *
 * ```ts
 * import { DeviceRegistry } from "@freqgen/core";
 * import { SPOOKY2_DEVICES } from "@freqgen/spooky2";
 * import { FEELTECH_DEVICES } from "feeltech";
 *
 * const registry = new DeviceRegistry().registerAll([
 *   ...FEELTECH_DEVICES,
 *   ...SPOOKY2_DEVICES,
 * ]);
 * const gen = registry.create("xm", transport);
 * ```
 */

import { AwgError } from "./errors.js";
import type { SignalGenerator } from "./device.js";
import type { VerificationLevel } from "./limits.js";
import type { Transport } from "./transport.js";

export interface DeviceDescriptor {
  /** Stable lowercase identifier, e.g. `"fy6300"`, `"xm"`, `"genx-pro"`. */
  id: string;
  vendor: string;
  /** Human-readable name for menus and help text. */
  label: string;
  /**
   * How well this driver is established. Surfaced so a UI can mark unverified
   * drivers rather than presenting every entry as equally trustworthy.
   */
  verified: VerificationLevel;
  /** Extra context for the unverified ones — what is untested, and why. */
  note?: string;
  create(transport: Transport, options?: Record<string, unknown>): SignalGenerator;
}

export class DeviceRegistry {
  private byId = new Map<string, DeviceDescriptor>();

  register(descriptor: DeviceDescriptor): this {
    this.byId.set(descriptor.id.toLowerCase(), descriptor);
    return this;
  }

  registerAll(descriptors: Iterable<DeviceDescriptor>): this {
    for (const d of descriptors) this.register(d);
    return this;
  }

  get(id: string): DeviceDescriptor | undefined {
    return this.byId.get(id.toLowerCase());
  }

  /** Every registered descriptor, sorted by vendor then label. */
  list(): DeviceDescriptor[] {
    return [...this.byId.values()].sort(
      (a, b) => a.vendor.localeCompare(b.vendor) || a.label.localeCompare(b.label),
    );
  }

  create(
    id: string,
    transport: Transport,
    options?: Record<string, unknown>,
  ): SignalGenerator {
    const descriptor = this.get(id);
    if (!descriptor) {
      const known = this.list().map((d) => d.id).join(", ");
      throw new AwgError(
        `Unknown device "${id}"${known ? ` — registered devices: ${known}` : ""}`,
      );
    }
    return descriptor.create(transport, options);
  }
}
