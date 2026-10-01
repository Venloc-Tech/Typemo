import { ConnectionError } from "./connection-error.ts";
import { DriverError } from "./driver-error.ts";
import { DuplicateKeyError } from "./duplicate-key-error.ts";
import { DuplicateKeyText } from "./duplicate-key-text.ts";
import { ServerError, type ServerErrorDetails } from "./server-error.ts";
import { ServerErrorCodes } from "./server-error-codes.ts";
import { ServerValidationError } from "./server-validation-error.ts";
import { TimeoutError } from "./timeout-error.ts";
import { TypemoError } from "./typemo-error.ts";
import { WriteConflictError } from "./write-conflict-error.ts";

/**
 * The fields of a driver error Typemo reads (all optional: they are checked, not trusted).
 *
 * @example
 * ```ts
 * const shape: DriverErrorShape = Object.assign(new Error("x"), { code: 11000 });
 * ```
 */
export interface DriverErrorShape extends Error {
  /** The server error code. */
  readonly code?: unknown;
  /** The server error code name. */
  readonly codeName?: unknown;
  /** The server error labels. */
  readonly errorLabels?: unknown;
  /** Details of a document validation failure. */
  readonly errInfo?: unknown;
  /** The index key pattern of a duplicate key error. */
  readonly keyPattern?: unknown;
  /** The duplicated key value of a duplicate key error. */
  readonly keyValue?: unknown;
  /** The raw server message. */
  readonly errmsg?: unknown;
  /** Failed writes of a bulk error. */
  readonly writeErrors?: unknown;
  /** The result of a bulk error. */
  readonly result?: unknown;
}

/**
 * Narrows to a plain (non-array) object.
 *
 * @param value - Any value.
 * @returns `true` for a non-null, non-array object.
 */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * @internal Turns driver errors into the Typemo hierarchy and reads their fields. Used by the core only; the
 * public {@link ErrorClassifier} answers questions about an error and never exposes this machinery.
 *
 * Driver errors are recognized by their `name` and fields, never by `instanceof` (a second copy of `mongodb`
 * in an install has other classes). The driver error is always kept as `cause`, unchanged.
 *
 * @example
 * ```ts
 * throw ErrorTranslator.wrap(driverError);
 * ```
 */
export class ErrorTranslator {
  /**
   * Key of the raw driver error kept on a server error whose public `cause` is a masked copy (the original may
   * hold sensitive data): non-enumerable, never serialized; {@link driverCause} reads it (transaction retries
   * need its labels).
   */
  static readonly DRIVER_ERROR: unique symbol = Symbol("typemo.driverError");

  /**
   * Tells whether an error comes from the `mongodb` driver (by its class name, not `instanceof`).
   *
   * @param error - Any thrown value.
   * @returns `true` for a driver error.
   */
  static isDriverError(error: unknown): error is DriverErrorShape {
    return error instanceof Error && !(error instanceof TypemoError) && /^Mongo[A-Za-z]*Error$/.test(error.name);
  }

  /**
   * Reads the error labels of any error (Typemo or driver).
   *
   * @param error - Any thrown value.
   * @returns The labels; empty when there are none.
   */
  static labelsOf(error: unknown): readonly string[] {
    if (error instanceof ServerError || error instanceof ConnectionError || error instanceof DriverError) {
      return error.errorLabels;
    }
    const labels = (error as { errorLabels?: unknown } | null)?.errorLabels;
    return Array.isArray(labels) ? labels.filter((label): label is string => typeof label === "string") : [];
  }

  /**
   * Reads the server code of any error (its own, or its driver cause's).
   *
   * @param error - Any thrown value.
   * @returns The code, or `undefined` when there is none.
   */
  static codeOf(error: unknown): number | undefined {
    if (error instanceof ServerError) return error.code;
    const own = (error as { code?: unknown } | null)?.code;
    if (typeof own === "number") return own;
    const cause = (error as { cause?: unknown } | null)?.cause;
    return cause !== undefined && cause !== error && ErrorTranslator.isDriverError(cause)
      ? ErrorTranslator.codeOf(cause)
      : undefined;
  }

  /**
   * A driver error as a Typemo error (the driver error is the `cause`); a Typemo error and any other error (a user
   * hook's own error) are returned as they are.
   *
   * @param error - Any thrown value.
   * @returns The Typemo error for a driver error; otherwise `error` itself.
   */
  static wrap(error: unknown): unknown {
    if (!ErrorTranslator.isDriverError(error)) return error;
    const labels = ErrorTranslator.labelsOf(error);
    const message = error.message;
    switch (error.name) {
      case "MongoOperationTimeoutError":
        return new TimeoutError("operation", `operation timed out (timeoutMS): ${message}`, { cause: error });
      case "MongoServerSelectionError":
        return new ConnectionError("server-selection", `no server available: ${message}`, {
          cause: error,
          errorLabels: labels,
        });
      case "MongoNetworkError":
      case "MongoNetworkTimeoutError":
        return new ConnectionError("network", `network error: ${message}`, { cause: error, errorLabels: labels });
      case "MongoTopologyClosedError":
      case "MongoClientClosedError":
      case "MongoNotConnectedError":
        return new ConnectionError("closed", `the client is closed: ${message}`, { cause: error, errorLabels: labels });
    }
    const code = typeof error.code === "number" ? error.code : undefined;
    if (code === undefined && !/^Mongo(Server|WriteConcern|BulkWrite)Error$/.test(error.name)) {
      return new DriverError(error.name, message, { cause: error, errorLabels: labels });
    }
    const details: ServerErrorDetails = {
      code,
      codeName: typeof error.codeName === "string" ? error.codeName : undefined,
      errorLabels: labels,
      cause: error,
      serverMessage: message,
    };
    return ErrorTranslator.serverError(code, message, details, error);
  }

  /**
   * Builds the Typemo class of a server error by its code.
   *
   * @param code - The server error code, if any.
   * @param message - The server message.
   * @param given - Code, labels and cause to put on the error; a missing `codeName` is filled from the table of
   *   known codes.
   * @param source - The driver error fields (`errInfo`, `keyPattern`, `keyValue`) some classes copy.
   * @returns `DuplicateKeyError`, `ServerValidationError`, `WriteConflictError`, `TimeoutError`, `ConnectionError`
   *   or the general `ServerError`.
   */
  static serverError(
    code: number | undefined,
    message: string,
    given: ServerErrorDetails,
    source: { readonly errInfo?: unknown; readonly keyPattern?: unknown; readonly keyValue?: unknown },
  ): TypemoError {
    const details: ServerErrorDetails = { ...given, codeName: given.codeName ?? ErrorTranslator.codeNameOf(code) };
    switch (code) {
      case ServerErrorCodes.DuplicateKey:
      case 11001: {
        const keyValue = isRecord(source.keyValue) ? source.keyValue : undefined;
        const index = /index: (\S+)/.exec(message)?.[1];
        /* The thrown form shows the key value as the server gave it; a field marked sensitive is masked afterwards. */
        return new DuplicateKeyError(DuplicateKeyText.of(index, keyValue, code, details.codeName), {
          ...details,
          serverMessage: message,
          keyPattern: isRecord(source.keyPattern) ? source.keyPattern : undefined,
          keyValue,
          index,
        });
      }
      case ServerErrorCodes.DocumentValidationFailure:
        return new ServerValidationError(`the collection validator refused the document: ${message}`, {
          ...details,
          errInfo: isRecord(source.errInfo) ? source.errInfo : undefined,
        });
      case ServerErrorCodes.WriteConflict:
        return new WriteConflictError(`write conflict: ${message}`, details);
      case ServerErrorCodes.MaxTimeMSExpired:
        return new TimeoutError("operation", `the server stopped the operation (MaxTimeMSExpired): ${message}`, {
          cause: details.cause,
        });
      case ServerErrorCodes.AuthenticationFailed:
        return new ConnectionError("authentication", `authentication failed: ${message}`, {
          cause: details.cause,
          errorLabels: details.errorLabels,
        });
      default:
        return new ServerError(ErrorTranslator.summary(message, code, details.codeName), {
          ...details,
          serverMessage: message,
        });
    }
  }

  /**
   * The name of a server code from the table of known codes (the server leaves `codeName` out of some
   * replies, such as write errors).
   *
   * @param code - The server error code, if any.
   * @returns The name, or `undefined` for an unknown code.
   */
  static codeNameOf(code: number | undefined): string | undefined {
    if (code === undefined) return undefined;
    for (const [name, value] of Object.entries(ServerErrorCodes)) if (value === code) return name;
    return undefined;
  }

  /**
   * A short message for a server error: the innermost reason (after the last `:: caused by ::`), its first
   * sentence, and the code. Query plans and values in the rest of the server text stay out of the message.
   *
   * @param text - The full server text.
   * @param code - The server error code, if any.
   * @param codeName - The code name, if known.
   * @returns The short message.
   */
  static summary(text: string, code: number | undefined, codeName: string | undefined): string {
    const reason = (text.split(":: caused by ::").pop() ?? text).trim();
    const sentence = /^(.*?[.!?])(?:\s|$)/s.exec(reason)?.[1] ?? reason;
    const bounded = sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence;
    const named = code === undefined ? "" : ` (code ${code}${codeName === undefined ? "" : ` ${codeName}`})`;
    return `${bounded === "" ? "the server refused the operation" : bounded}${named}`;
  }

  /**
   * The driver error behind a Typemo error (its `cause` chain), or the error itself. `transaction()` hands this to
   * the driver's `withTransaction`: it retries only errors that are driver errors carrying
   * `TransientTransactionError`, so a wrapped one must be unwrapped for the retry to happen.
   *
   * @param error - Any thrown value.
   * @returns The driver error when there is one behind `error`; otherwise `error`.
   */
  static driverCause(error: unknown): unknown {
    let current: unknown = error;
    for (let depth = 0; depth < 8 && current instanceof TypemoError; depth++) {
      /* The key is a symbol the error classes do not declare: it is attached by the sensitive mask only. */
      const raw: unknown = (current as unknown as Readonly<Record<symbol, unknown>>)[ErrorTranslator.DRIVER_ERROR];
      if (ErrorTranslator.isDriverError(raw)) return raw;
      const cause: unknown = current.cause;
      if (ErrorTranslator.isDriverError(cause)) return cause;
      if (cause === undefined || cause === current) break;
      current = cause;
    }
    return error;
  }
}
