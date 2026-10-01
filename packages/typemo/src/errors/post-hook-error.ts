import { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";

/**
 * A `post` hook failed AFTER its write succeeded. Outside a transaction MongoDB keeps the write: the data is in the
 * database (`applied` is always `true`), so retrying the operation would write it again. `result` is what the
 * write returned (the saved document, the update result, the inserted documents …); `cause` is the hook's error.
 * Inside a transaction a failing post hook aborts it and the write is rolled back: the hook's error reaches the
 * caller as it was thrown, not this one.
 *
 * @example
 * ```ts
 * try {
 *   await Users.create({ name: "Ann" });
 * } catch (error) {
 *   if (error instanceof PostHookError) console.warn("saved, but a hook failed", error.cause);
 *   else throw error;
 * }
 * ```
 */
export class PostHookError extends TypemoError {
  /** The model whose hook failed. */
  readonly model: string;
  /** The operation (`insertOne`, `updateOne`, `save`, …). */
  readonly operation: string;
  /** The write is in the database. */
  readonly applied: true = true;
  /** What the write returned; not enumerable, so a logged error does not carry the documents. */
  declare readonly result: unknown;

  /**
   * @param model - The model whose hook failed.
   * @param operation - The operation that wrote.
   * @param result - What the write returned.
   * @param options - `cause`: the hook's error.
   */
  constructor(model: string, operation: string, result: unknown, options: TypemoErrorOptions = {}) {
    const reason = options.cause instanceof Error ? `: ${options.cause.message}` : "";
    super(
      `${model}.${operation}: a post hook failed after the write succeeded${reason}. The write IS applied (outside a transaction nothing rolls it back); do not repeat it — the hook's error is the cause`,
      options,
    );
    this.model = model;
    this.operation = operation;
    Object.defineProperty(this, "result", { value: result, enumerable: false, writable: false, configurable: true });
  }

  static {
    Object.defineProperty(PostHookError.prototype, "name", {
      value: "PostHookError",
      writable: true,
      configurable: true,
    });
  }
}
