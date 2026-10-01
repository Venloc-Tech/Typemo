import { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";

/**
 * A setup mistake, found before any data is touched: conflicting driver options, an impossible caster
 * definition (a vector with 0 dimensions, a union without members) or a schema that cannot be built.
 * Never thrown for user data; bad data is a `CastError`.
 */
export class ConfigurationError extends TypemoError {
  /**
   * @param message - What is wrong with the configuration.
   * @param options - Optional `cause`.
   */
  constructor(message: string, options: TypemoErrorOptions = {}) {
    super(message, options);
  }

  static {
    Object.defineProperty(ConfigurationError.prototype, "name", {
      value: "ConfigurationError",
      writable: true,
      configurable: true,
    });
  }
}
