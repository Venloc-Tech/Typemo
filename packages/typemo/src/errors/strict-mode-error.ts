import { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";

/**
 * Which strictness rule an operation broke. A closed list:
 * - `unknown-path` — a path the schema does not declare (filter, update, projection, sort, pipeline);
 * - `not-hidden` — `select({ "+name": true })` of a field that is not `Hidden` (the `+` would change nothing);
 * - `undefined` — `undefined` as a value (the driver would send `null`);
 * - `empty-filter` — an empty filter on an operation that changes or removes documents (`updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany`, `findOneAnd*`);
 * - `empty-logical` — an empty `$and`/`$or`/`$nor`;
 * - `empty-update` — an update that is empty after casting;
 * - `immutable` — a write of an immutable path outside `$setOnInsert`;
 * - `limit` — `limit ≤ 0`;
 * - `sanitize` — an operator where a value was expected (`sanitizeFilter`, always on);
 * - `tenant` — an operation that would cross the tenant, or has none;
 * - `soft-delete` — an operation the soft delete policy cannot scope;
 * - `transaction-option` — `readConcern`/`writeConcern` on an operation inside a transaction;
 * - `concurrent-session` — the session is already used by another operation in flight.
 *
 * @example
 * ```ts
 * const reason: StrictModeReason = "unknown-path";
 * ```
 */
export type StrictModeReason =
  | "unknown-path"
  | "not-hidden"
  | "undefined"
  | "empty-filter"
  | "empty-logical"
  | "empty-update"
  | "immutable"
  | "limit"
  | "sanitize"
  | "tenant"
  | "soft-delete"
  | "transaction-option"
  | "concurrent-session";

/**
 * An operation broke a strictness rule; there are no relaxations. Thrown by the pipeline before the driver
 * is called.
 */
export class StrictModeError extends TypemoError {
  /** The rule that was broken. */
  readonly reason: StrictModeReason;
  /** Where in the input the rule was broken; `undefined` when the rule is about the whole operation. */
  readonly path: string | undefined;

  /**
   * @param reason - The rule that was broken; appended to the message as `[reason]`.
   * @param message - Human-readable description.
   * @param options - Optional `cause` and the `path` of the offending input.
   */
  constructor(
    reason: StrictModeReason,
    message: string,
    options: TypemoErrorOptions & { readonly path?: string } = {},
  ) {
    super(`${message} [${reason}]`, options);
    this.reason = reason;
    this.path = options.path;
  }

  static {
    Object.defineProperty(StrictModeError.prototype, "name", {
      value: "StrictModeError",
      writable: true,
      configurable: true,
    });
  }
}
