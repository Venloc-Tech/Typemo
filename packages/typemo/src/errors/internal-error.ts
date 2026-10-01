import { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";

/**
 * A broken invariant of Typemo itself: an object that is not a hydrated document where one must be, or a
 * single-row query asked for a cursor. Never caused by user data; report it as a bug. It is part of the
 * hierarchy, so `instanceof TypemoError` still separates Typemo's failures from anything else.
 */
export class InternalError extends TypemoError {
  /**
   * @param message - What invariant was broken; prefixed with `Internal error: `.
   * @param options - Optional `cause`.
   */
  constructor(message: string, options: TypemoErrorOptions = {}) {
    super(`Internal error: ${message}`, options);
  }

  static {
    Object.defineProperty(InternalError.prototype, "name", {
      value: "InternalError",
      writable: true,
      configurable: true,
    });
  }
}
