/**
 * Error types shared by every driver.
 *
 * Vendor packages re-export these under their own names where they already had
 * a public error type (e.g. `feeltech` exports `AwgError` as `FeelTechError`),
 * so `instanceof` keeps working in both directions — the aliases are the same
 * class objects, not subclasses.
 */

export class AwgError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AwgError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** No data arrived from the device within the read timeout. */
export class AwgTimeoutError extends AwgError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "AwgTimeoutError";
  }
}

/** The device answered, but not with something we can parse. */
export class AwgProtocolError extends AwgError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "AwgProtocolError";
  }
}

/**
 * A verified write kept reading back a different value — either the firmware
 * dropped the write repeatedly or it clamped the value (e.g. a frequency beyond
 * the device's range).
 */
export class AwgVerifyError extends AwgError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "AwgVerifyError";
  }
}
