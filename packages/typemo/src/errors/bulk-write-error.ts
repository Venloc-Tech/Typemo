import { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";

/**
 * One failed write of an `insertMany`/`bulkWrite`.
 *
 * @example
 * ```ts
 * declare const error: BulkWriteError;
 * for (const failure of error.writeErrors) console.log(failure.index, failure.code, failure.message);
 * ```
 */
export interface BulkWriteFailure {
  /** The index in the user's input (documents / operations), never the index inside a driver batch. */
  readonly index: number;
  /** The server code (`11000`, `121`, …); `undefined` for a write refused before the server (cast, validation). */
  readonly code: number | undefined;
  /** The message of the failure: the server's text for a server failure (the short form is `error.message`). */
  readonly message: string;
  /** The classified error: `DuplicateKeyError`, `ServerValidationError`, `CastError`, `ValidationError`, … */
  readonly error: TypemoError;
}

/**
 * What the writes that DID happen changed (driver `BulkWriteResult`, normalized).
 *
 * @example
 * ```ts
 * declare const error: BulkWriteError;
 * const { insertedCount, insertedIds } = error.result;
 * ```
 */
export interface BulkWriteSummary {
  /** Number of inserted documents. */
  readonly insertedCount: number;
  /** Number of documents matched by update/replace operations. */
  readonly matchedCount: number;
  /** Number of documents actually modified. */
  readonly modifiedCount: number;
  /** Number of deleted documents. */
  readonly deletedCount: number;
  /** Number of upserted documents. */
  readonly upsertedCount: number;
  /** `_id` of inserted documents by input index. */
  readonly insertedIds: Readonly<Record<number, unknown>>;
  /** `_id` of upserted documents by input index. */
  readonly upsertedIds: Readonly<Record<number, unknown>>;
}

/**
 * Some writes of an `insertMany`/`bulkWrite` failed. `writeErrors` lists every failure with its
 * index in the input and the server `code` kept (Mongoose spread the driver's `WriteError` and lost
 * `code`); `result` says what was written. Ordered: the writes after the first failure were not attempted.
 *
 * @example
 * ```ts
 * try {
 *   await Users.insertMany([{ name: "Ann" }, { name: "Bob" }], { ordered: false });
 * } catch (error) {
 *   if (error instanceof BulkWriteError) console.log(error.writeErrors.map((failure) => failure.index));
 * }
 * ```
 */
export class BulkWriteError extends TypemoError {
  /** Every failure, sorted by input index. */
  readonly writeErrors: readonly BulkWriteFailure[];
  /** What the writes that succeeded changed. */
  readonly result: BulkWriteSummary;
  /** Whether the operation was ordered (later writes were skipped after the first failure). */
  readonly ordered: boolean;

  /**
   * @param operation - The operation name for the message (`insertMany`, `bulkWrite`).
   * @param writeErrors - The failures.
   * @param result - What was written before and around the failures.
   * @param ordered - Whether the operation was ordered.
   * @param options - Optional `cause` and labels.
   */
  constructor(
    operation: string,
    writeErrors: readonly BulkWriteFailure[],
    result: BulkWriteSummary,
    ordered: boolean,
    options: TypemoErrorOptions = {},
  ) {
    /* The failures arrive in the order they were found (Typemo's own checks first, then the server's): "first" is the lowest input index. */
    const sorted = [...writeErrors].sort((a, b) => a.index - b.index);
    const first = sorted[0];
    super(
      `${operation}: ${writeErrors.length} write(s) failed${first === undefined ? "" : ` (first at index ${first.index}: ${first.error.message})`}`,
      options,
    );
    this.writeErrors = Object.freeze(sorted);
    this.result = Object.freeze({ ...result });
    this.ordered = ordered;
  }

  static {
    Object.defineProperty(BulkWriteError.prototype, "name", {
      value: "BulkWriteError",
      writable: true,
      configurable: true,
    });
  }
}
