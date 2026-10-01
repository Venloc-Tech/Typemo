import { PostHookError } from "../errors/post-hook-error.ts";
import { TypemoError } from "../errors/typemo-error.ts";

/**
 * What a hook's failure turns into, so that no error is lost: a `post` hook failing after a write is a
 * `PostHookError` (the write stays), and a `postError` hook failing keeps the error it was handling.
 *
 * @example
 * ```ts
 * throw HookErrors.afterWrite("User", "insertOne", doc, hookError, false); // a PostHookError
 * ```
 */
export class HookErrors {
  /**
   * The error of a `post` hook that failed after its write succeeded.
   *
   * @param model - The model name.
   * @param operation - The operation that wrote.
   * @param result - What the write returned.
   * @param error - The hook's error.
   * @param inTransaction - Whether the write runs in a transaction (it is rolled back with the hook's error).
   * @returns A `PostHookError` outside a transaction; the hook's error as it is inside one.
   */
  static afterWrite(
    model: string,
    operation: string,
    result: unknown,
    error: unknown,
    inTransaction: boolean,
  ): unknown {
    if (inTransaction || error instanceof PostHookError) return error;
    return new PostHookError(model, operation, result, { cause: error });
  }

  /**
   * The error to throw when a `postError` hook threw while it handled `original`: the hook's error, with
   * `original` as its `cause`. A hook error that already has a cause (or is not an object) is wrapped in a
   * `TypemoError` whose `cause` is `original` and whose message carries the hook's.
   *
   * @param thrown - What the `postError` hook threw.
   * @param original - The error the hook was handling.
   * @returns The error to throw.
   */
  static chain(thrown: unknown, original: unknown): unknown {
    if (thrown === original) return thrown;
    if (thrown instanceof Error && thrown.cause === undefined) {
      Object.defineProperty(thrown, "cause", {
        value: original,
        enumerable: false,
        writable: true,
        configurable: true,
      });
      return thrown;
    }
    const text = thrown instanceof Error ? thrown.message : String(thrown);
    return new TypemoError(`a postError hook failed (${text}) while it handled the error that is the cause`, {
      cause: original,
    });
  }
}
