import { SyncError } from "../collections/sync-error.ts";
import { AuditError } from "./audit-error.ts";
import { BulkWriteError } from "./bulk-write-error.ts";
import { CastError } from "./cast-error.ts";
import { ConfigurationError } from "./configuration-error.ts";
import { ConnectionError } from "./connection-error.ts";
import { DocumentNotFoundError } from "./document-not-found-error.ts";
import { DriverError } from "./driver-error.ts";
import { DuplicateKeyError } from "./duplicate-key-error.ts";
import { EachAsyncError } from "./each-async-error.ts";
import { ErrorTranslator } from "./error-translator.ts";
import { IndexSyncError } from "./index-sync-error.ts";
import { PostHookError } from "./post-hook-error.ts";
import { QueryError } from "./query-error.ts";
import { ServerError } from "./server-error.ts";
import { ErrorLabels, ServerErrorCodes } from "./server-error-codes.ts";
import { ServerValidationError } from "./server-validation-error.ts";
import { StrictModeError } from "./strict-mode-error.ts";
import { TimeoutError } from "./timeout-error.ts";
import { ValidationError } from "./validation-error.ts";
import { VersionError } from "./version-error.ts";
import { WriteConflictError } from "./write-conflict-error.ts";

/**
 * What kind of failure an error is.
 *
 * @example
 * ```ts
 * const kind: ErrorKind = "duplicate-key";
 * ```
 */
export type ErrorKind =
  | "validation"
  | "cast"
  | "strict"
  | "query"
  | "configuration"
  | "not-found"
  | "version"
  | "duplicate-key"
  | "server-validation"
  | "write-conflict"
  | "timeout"
  | "bulk-write"
  | "index-sync"
  | "post-hook"
  | "audit"
  | "each-async"
  | "connection"
  | "server"
  | "driver"
  | "other";

/**
 * The classification of an error (instrumentation `operation.error`, retry decisions).
 *
 * @example
 * ```ts
 * declare const error: unknown;
 * const { kind, retryable } = ErrorClassifier.classify(error);
 * ```
 */
export interface ErrorClassification {
  /** What kind of failure it is. */
  readonly kind: ErrorKind;
  /** The error class name (`DuplicateKeyError`, `TypeError` for a user hook's bug, …). */
  readonly name: string;
  /** The server error code, when there is one. */
  readonly code: number | undefined;
  /** The server error labels (`TransientTransactionError`, …). */
  readonly errorLabels: readonly string[];
  /** The operation may succeed when retried as is (a transient server/network condition). */
  readonly retryable: boolean;
  /** The error carries `TransientTransactionError`: the whole transaction may be retried. */
  readonly transient: boolean;
}

/** Server codes of transient conditions: the same operation may succeed when retried. */
const RETRYABLE_CODES: ReadonlySet<number> = new Set<number>([
  ServerErrorCodes.HostUnreachable,
  ServerErrorCodes.HostNotFound,
  ServerErrorCodes.NetworkTimeout,
  ServerErrorCodes.ShutdownInProgress,
  ServerErrorCodes.PrimarySteppedDown,
  ServerErrorCodes.ExceededTimeLimit,
  ServerErrorCodes.NotWritablePrimary,
  ServerErrorCodes.InterruptedAtShutdown,
  ServerErrorCodes.InterruptedDueToReplStateChange,
  ServerErrorCodes.WriteConflict,
]);

/**
 * Classifies any error for retry decisions, logs and metrics: `classify` tells its kind, code, labels and whether a
 * retry may help; `isRetryable`, `isTransient`, `isTimeout`, `isDuplicateKey` and `hasDuplicateKey` answer one
 * question each.
 *
 * Any thrown value is accepted: a Typemo error, a raw error of the `mongodb` driver (classified as the Typemo error
 * Typemo would turn it into; the driver is recognized by the error's `name`, not `instanceof`) or anything else
 * (kind `"other"`).
 *
 * @example
 * ```ts
 * declare const error: unknown;
 * const { retryable } = ErrorClassifier.classify(error);
 * ```
 */
export class ErrorClassifier {
  /**
   * Classifies any error: a Typemo error, a raw driver error (classified as the Typemo error it becomes) or any
   * other value (kind `"other"`).
   *
   * @param error - Any thrown value.
   * @returns Its kind, name, code, labels and whether a retry may help; frozen.
   *
   * @example
   * ```ts
   * const signUp = async (name: string): Promise<"created" | "taken" | "later"> => {
   *   try {
   *     await Users.create({ name });
   *     return "created";
   *   } catch (error) {
   *     const { kind, retryable } = ErrorClassifier.classify(error);
   *     if (kind === "duplicate-key") return "taken";
   *     if (retryable) return "later";
   *     throw error;
   *   }
   * };
   * ```
   */
  static classify(error: unknown): ErrorClassification {
    const wrapped = ErrorTranslator.wrap(error);
    const labels = ErrorTranslator.labelsOf(wrapped);
    const code = ErrorTranslator.codeOf(wrapped);
    const kind = ErrorClassifier.kindOf(wrapped);
    const transient = labels.includes(ErrorLabels.TransientTransactionError);
    const retryable =
      transient ||
      labels.includes(ErrorLabels.RetryableWriteError) ||
      (wrapped instanceof ConnectionError && wrapped.failure !== "closed" && wrapped.failure !== "authentication") ||
      (code !== undefined && RETRYABLE_CODES.has(code));
    return Object.freeze({
      kind,
      name: wrapped instanceof Error ? wrapped.name : typeof wrapped,
      code,
      errorLabels: labels,
      retryable,
      transient,
    });
  }

  /**
   * Tells whether an error is a duplicate key error (never a bulk error: see {@link hasDuplicateKey}).
   *
   * @param error - Any thrown value.
   * @returns `true` for a duplicate key error.
   *
   * @example
   * ```ts
   * declare const error: unknown;
   * if (ErrorClassifier.isDuplicateKey(error)) console.log(error.keyValue);
   * ```
   */
  static isDuplicateKey(error: unknown): error is DuplicateKeyError {
    return ErrorTranslator.wrap(error) instanceof DuplicateKeyError;
  }

  /**
   * Tells whether an error is a duplicate key error or a bulk error with at least one duplicate key failure.
   *
   * @param error - Any thrown value.
   * @returns `true` when a duplicate key is involved.
   *
   * @example
   * ```ts
   * declare const error: unknown;
   * const status = ErrorClassifier.hasDuplicateKey(error) ? 409 : 500;
   * ```
   */
  static hasDuplicateKey(error: unknown): boolean {
    const wrapped = ErrorTranslator.wrap(error);
    return (
      wrapped instanceof DuplicateKeyError ||
      (wrapped instanceof BulkWriteError &&
        wrapped.writeErrors.some((failure) => failure.error instanceof DuplicateKeyError))
    );
  }

  /**
   * Tells whether retrying the same operation may succeed.
   *
   * @param error - Any thrown value.
   * @returns `true` for a transient condition.
   *
   * @example
   * ```ts
   * declare const error: unknown;
   * const retry = ErrorClassifier.isRetryable(error);
   * ```
   */
  static isRetryable(error: unknown): boolean {
    return ErrorClassifier.classify(error).retryable;
  }

  /**
   * Tells whether the error carries `TransientTransactionError`.
   *
   * @param error - Any thrown value.
   * @returns `true` when the whole transaction may be retried.
   *
   * @example
   * ```ts
   * declare const error: unknown;
   * const again = ErrorClassifier.isTransient(error); // the whole transaction may run again
   * ```
   */
  static isTransient(error: unknown): boolean {
    return ErrorClassifier.classify(error).transient;
  }

  /**
   * Tells whether an error is a timeout (operation, connection or transaction).
   *
   * @param error - Any thrown value.
   * @returns `true` for a `TimeoutError`.
   *
   * @example
   * ```ts
   * declare const error: unknown;
   * if (ErrorClassifier.isTimeout(error)) console.log(error.kind);
   * ```
   */
  static isTimeout(error: unknown): error is TimeoutError {
    return ErrorTranslator.wrap(error) instanceof TimeoutError;
  }

  /**
   * Maps a (translated) error to its {@link ErrorKind}.
   *
   * @param error - An error already turned into the Typemo hierarchy.
   * @returns The kind; `"other"` for anything outside the Typemo hierarchy.
   */
  private static kindOf(error: unknown): ErrorKind {
    if (error instanceof ValidationError) return "validation";
    if (error instanceof CastError) return "cast";
    if (error instanceof StrictModeError) return "strict";
    if (error instanceof QueryError) return "query";
    if (error instanceof ConfigurationError) return "configuration";
    if (error instanceof DocumentNotFoundError) return "not-found";
    if (error instanceof VersionError) return "version";
    if (error instanceof DuplicateKeyError) return "duplicate-key";
    if (error instanceof ServerValidationError) return "server-validation";
    if (error instanceof WriteConflictError) return "write-conflict";
    if (error instanceof TimeoutError) return "timeout";
    if (error instanceof BulkWriteError) return "bulk-write";
    /* The sync of `connection.init()`/`syncAll()` lists the failures of indexes and collections. */
    if (error instanceof IndexSyncError || error instanceof SyncError) return "index-sync";
    /* `PostHookError` means the write was applied: a retry would write twice, so it must not read as `other`. */
    if (error instanceof PostHookError) return "post-hook";
    if (error instanceof AuditError) return "audit";
    if (error instanceof EachAsyncError) return "each-async";
    if (error instanceof ConnectionError) return "connection";
    if (error instanceof ServerError) return "server";
    if (error instanceof DriverError) return "driver";
    return "other";
  }
}
