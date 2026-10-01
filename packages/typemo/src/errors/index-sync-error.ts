import { TypemoError } from "./typemo-error.ts";

/**
 * One index that could not be created, dropped or changed (search indexes use the `*Search` actions).
 *
 * @example
 * ```ts
 * const failure: IndexFailure = { name: "email_1", action: "create", error: new TypemoError("boom") };
 * ```
 */
export interface IndexFailure {
  /** The index name. */
  readonly name: string;
  /** The operation that failed. */
  readonly action: "create" | "drop" | "modify" | "createSearch" | "updateSearch" | "dropSearch";
  /** The error of that operation. */
  readonly error: TypemoError;
}

/**
 * `syncIndexes`/`createIndexes` could not apply every index. ALL failures are collected (Mongoose stopped
 * at the first failing model); the indexes that succeeded stay applied.
 */
export class IndexSyncError extends TypemoError {
  /** The model whose indexes were synced. */
  readonly model: string;
  /** Every failed index operation (frozen). */
  readonly failures: readonly IndexFailure[];

  /**
   * @param model - The model whose indexes were synced.
   * @param failures - Every failed index operation; listed in the message.
   */
  constructor(model: string, failures: readonly IndexFailure[]) {
    /* A failure's own message may start with the model's name too: the message names the model once. */
    const own = `${model}: `;
    super(
      `${model}: ${failures.length} index operation(s) failed: ${failures
        .map((failure) => {
          const text = failure.error.message;
          return `${failure.action} ${failure.name}: ${text.startsWith(own) ? text.slice(own.length) : text}`;
        })
        .join("; ")}`,
    );
    this.model = model;
    this.failures = Object.freeze([...failures]);
  }

  static {
    Object.defineProperty(IndexSyncError.prototype, "name", {
      value: "IndexSyncError",
      writable: true,
      configurable: true,
    });
  }
}
