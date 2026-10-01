import { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";

/**
 * The driver refused an operation on the client side: an API misuse the driver detects, such as an
 * expired session, a transaction in the wrong state or an invalid argument that reached it. The driver
 * error is kept as the `cause`.
 */
export class DriverError extends TypemoError {
  /** The driver's error class name (`MongoTransactionError`, …). */
  readonly driverError: string;
  /** The driver's error labels, frozen. */
  readonly errorLabels: readonly string[];

  /**
   * @param driverError - The driver's error class name.
   * @param message - Human-readable description.
   * @param options - `cause` (the driver error) and the driver's `errorLabels`.
   */
  constructor(
    driverError: string,
    message: string,
    options: TypemoErrorOptions & { readonly errorLabels?: readonly string[] } = {},
  ) {
    super(message, options);
    this.driverError = driverError;
    this.errorLabels = Object.freeze([...(options.errorLabels ?? [])]);
  }

  static {
    Object.defineProperty(DriverError.prototype, "name", { value: "DriverError", writable: true, configurable: true });
  }
}
