import { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";

/**
 * Where the time ran out.
 *
 * @example
 * ```ts
 * const kind: TimeoutKind = "operation";
 * ```
 */
export type TimeoutKind =
  /** The operation's `timeoutMS` (driver CSOT) or the server's `MaxTimeMSExpired` (50). */
  | "operation"
  /** Waiting for the connection before `connect()` finished. */
  | "connection"
  /** A transaction's `timeoutMS` (retries included). */
  | "transaction";

/** An operation ran out of time. `cause` is the driver or server error when there is one. */
export class TimeoutError extends TypemoError {
  /** Where the time ran out. */
  readonly kind: TimeoutKind;
  /** The limit that was exceeded, when known. */
  readonly timeoutMS: number | undefined;

  /**
   * @param kind - Where the time ran out.
   * @param message - Human-readable description.
   * @param options - Optional `cause` and the exceeded `timeoutMS`.
   */
  constructor(
    kind: TimeoutKind,
    message: string,
    options: TypemoErrorOptions & { readonly timeoutMS?: number | undefined } = {},
  ) {
    super(message, options);
    this.kind = kind;
    this.timeoutMS = options.timeoutMS;
  }

  /**
   * @internal The same timeout attributed to the limit that ran out: the classifier sees only the driver
   * error, the caller knows which `timeoutMS` it set (an operation's, a transaction's).
   *
   * @param error - Any thrown value.
   * @param kind - Where the limit was set.
   * @param timeoutMS - The limit, when one was set.
   * @returns A new `TimeoutError` with that kind and limit when `error` is a `TimeoutError` of kind
   * `operation` and a limit is known; otherwise `error` itself.
   */
  static withLimit(error: unknown, kind: TimeoutKind, timeoutMS: number | undefined): unknown {
    if (!(error instanceof TimeoutError) || error.kind !== "operation" || timeoutMS === undefined) return error;
    if (error.kind === kind && error.timeoutMS === timeoutMS) return error;
    const message = kind === "transaction" ? `transaction timed out after ${timeoutMS} ms (timeoutMS)` : error.message;
    return new TimeoutError(kind, message, { cause: error.cause ?? error, timeoutMS });
  }

  static {
    Object.defineProperty(TimeoutError.prototype, "name", {
      value: "TimeoutError",
      writable: true,
      configurable: true,
    });
  }
}
