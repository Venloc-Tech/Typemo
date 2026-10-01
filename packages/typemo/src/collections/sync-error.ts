import { TypemoError } from "../errors/typemo-error.ts";
import type { SyncReport } from "./sync-all.ts";

/**
 * The failures of one collection or view in a {@link SyncError}.
 *
 * @example
 * ```ts
 * declare const error: SyncError;
 * const failure: SyncFailure | undefined = error.failures[0];
 * failure?.errors.map((cause) => cause.name); // ["IndexSyncError"]
 * ```
 */
export interface SyncFailure {
  /** Whether a model's collection or a view failed. */
  readonly kind: "collection" | "view";
  /** The collection or view name. */
  readonly name: string;
  /** The root model class of the collection; `undefined` for a view. */
  readonly model: string | undefined;
  /** Every failure of it (an `IndexSyncError`, a `CollectionOptionsError`, a `ServerError`, …), in step order. */
  readonly errors: readonly TypemoError[];
}

/**
 * `connection.init()` or `syncAll()` could not bring every collection and view in line with the models. Every
 * step of every model still ran (one failure never stops the others): the error lists the failures per
 * collection and view (`failures`), all of them in order (`errors`, also the `AggregateError` in `cause`), and
 * the whole report of what was found and done (`report`, with `failed: true`) — a dry run's included.
 *
 * @example
 * ```ts
 * try {
 *   await connection.init();
 * } catch (error) {
 *   if (error instanceof SyncError) for (const failure of error.failures) console.error(failure.name, failure.errors);
 * }
 * ```
 */
export class SyncError extends TypemoError {
  /** The method that failed. */
  readonly operation: "connection.init" | "syncAll";
  /** The failures per collection and view (only those that failed), frozen. */
  readonly failures: readonly SyncFailure[];
  /** Every original error, in report order (the same list as the `AggregateError` in `cause`), frozen. */
  readonly errors: readonly TypemoError[];
  /** The full report of the call (`failed: true`). */
  readonly report: SyncReport;

  /**
   * @param operation - The method that failed.
   * @param connection - The connection's name (its database), for the message.
   * @param report - The report of the call; it has at least one failure.
   */
  constructor(operation: "connection.init" | "syncAll", connection: string, report: SyncReport) {
    const failures: SyncFailure[] = [
      ...report.collections.map((entry) =>
        Object.freeze({
          kind: "collection" as const,
          name: entry.collection,
          model: entry.model,
          errors: entry.errors,
        }),
      ),
      ...report.views.map((entry) =>
        Object.freeze({ kind: "view" as const, name: entry.view, model: undefined, errors: entry.errors }),
      ),
    ].filter((failure) => failure.errors.length > 0);
    const errors = failures.flatMap((failure) => failure.errors);
    /* A `CollectionOptionsError` already starts with `collection "name": `: the name is said once. */
    const where = failures.map((failure) => {
      const own = `collection "${failure.name}": `;
      const texts = failure.errors.map((error) =>
        error.message.startsWith(own) ? error.message.slice(own.length) : error.message,
      );
      return `${failure.kind} "${failure.name}": ${texts.join("; ")}`;
    });
    super(`${operation}() of "${connection}": ${errors.length} failure(s) — ${where.join(" | ")}`, {
      cause: new AggregateError(errors, `${operation}() failures`),
    });
    this.operation = operation;
    this.failures = Object.freeze(failures);
    this.errors = Object.freeze(errors);
    this.report = report;
  }

  static {
    Object.defineProperty(SyncError.prototype, "name", { value: "SyncError", writable: true, configurable: true });
  }
}
