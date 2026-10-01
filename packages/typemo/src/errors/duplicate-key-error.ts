import { ServerError, type ServerErrorDetails } from "./server-error.ts";

/**
 * What a duplicate key error carries.
 *
 * @example
 * ```ts
 * const details: DuplicateKeyDetails = {
 *   code: 11000,
 *   codeName: "DuplicateKey",
 *   errorLabels: [],
 *   keyPattern: { email: 1 },
 *   keyValue: { email: "a@b.c" },
 *   index: "email_1",
 * };
 * ```
 */
export interface DuplicateKeyDetails extends ServerErrorDetails {
  /** The index keys (`{ email: 1 }`), when the server reports them. */
  readonly keyPattern: Readonly<Record<string, unknown>> | undefined;
  /** The duplicated values (`{ email: "a@b.c" }`), when the server reports them. */
  readonly keyValue: Readonly<Record<string, unknown>> | undefined;
  /** The index that refused the write, parsed from the message (`index: email_1`). */
  readonly index: string | undefined;
}

/** A write broke a unique index (server code 11000). */
export class DuplicateKeyError extends ServerError {
  /** The index keys, when the server reports them. */
  readonly keyPattern: Readonly<Record<string, unknown>> | undefined;
  /** The duplicated values, when the server reports them. */
  readonly keyValue: Readonly<Record<string, unknown>> | undefined;
  /** The name of the index that refused the write, when it could be parsed. */
  readonly index: string | undefined;

  /**
   * @param message - Human-readable description.
   * @param details - Server error details plus the key pattern, key value and index name.
   */
  constructor(message: string, details: DuplicateKeyDetails) {
    super(message, details);
    this.keyPattern = details.keyPattern;
    this.keyValue = details.keyValue;
    this.index = details.index;
  }

  static {
    Object.defineProperty(DuplicateKeyError.prototype, "name", {
      value: "DuplicateKeyError",
      writable: true,
      configurable: true,
    });
  }
}
