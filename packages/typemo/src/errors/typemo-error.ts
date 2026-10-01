/**
 * Options every Typemo error accepts.
 *
 * @example
 * ```ts
 * const options: TypemoErrorOptions = { cause: new Error("the original error") };
 * throw new ConfigurationError("bad option", options);
 * ```
 */
export interface TypemoErrorOptions {
  /** The original error (driver, bson, user code) that led to this one; it becomes `Error.cause`. */
  readonly cause?: unknown;
}

/**
 * Root of the Typemo error hierarchy. Every error Typemo throws is an instance of this class, so
 * `catch (e) { if (e instanceof TypemoError) … }` separates Typemo's own failures from anything else.
 * Subclasses add structured fields; the message is always readable on its own.
 *
 * @example
 * ```ts
 * try {
 *   await Users.findOne({ email }).orFail();
 * } catch (e) {
 *   if (e instanceof TypemoError) console.warn(e.message, { cause: e.cause });
 *   else throw e;
 * }
 * ```
 */
export class TypemoError extends Error {
  /**
   * @param message - Human-readable description; must make sense without the other fields.
   * @param options - Optional `cause`, the original error.
   */
  constructor(message: string, options: TypemoErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
  }

  /* `name` lives on the prototype (non-enumerable), like `Error.prototype.name`: an own `name` would
     show up in `Object.keys(error)` and in every structured log line. */
  static {
    Object.defineProperty(TypemoError.prototype, "name", { value: "TypemoError", writable: true, configurable: true });
  }
}
