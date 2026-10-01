import { TypemoError } from "./typemo-error.ts";

/**
 * `eachAsync(fn, { continueOnError: true })` finished, and some calls of `fn` failed: every error is
 * kept, in the order the documents came (Mongoose `EachAsyncMultiError`).
 */
export class EachAsyncError extends TypemoError {
  /** Every error thrown by the callback, in document order (frozen). */
  readonly errors: readonly unknown[];

  /**
   * @param errors - The errors collected from the failed callback calls; the first becomes the `cause`.
   */
  constructor(errors: readonly unknown[]) {
    super(`eachAsync: ${errors.length} call(s) of the callback failed (continueOnError)`, { cause: errors[0] });
    this.errors = Object.freeze([...errors]);
  }

  static {
    Object.defineProperty(EachAsyncError.prototype, "name", {
      value: "EachAsyncError",
      writable: true,
      configurable: true,
    });
  }
}
