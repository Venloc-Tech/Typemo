import { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";

/**
 * Why the connection failed.
 *
 * @example
 * ```ts
 * const failure: ConnectionFailure = "server-selection";
 * ```
 */
export type ConnectionFailure =
  /** The client is closed (after `close()`); create a new client. */
  | "closed"
  /** No server could be selected (`MongoServerSelectionError`). */
  | "server-selection"
  /** The network failed (`MongoNetworkError`). */
  | "network"
  /** The server refused the credentials. */
  | "authentication";

/** The client could not reach the server (or is closed). `cause` is the driver error. */
export class ConnectionError extends TypemoError {
  /** Why the connection failed. */
  readonly failure: ConnectionFailure;
  /** The driver's error labels, frozen. */
  readonly errorLabels: readonly string[];

  /**
   * @param failure - Why the connection failed.
   * @param message - Human-readable description.
   * @param options - Optional `cause` and the driver's `errorLabels`.
   */
  constructor(
    failure: ConnectionFailure,
    message: string,
    options: TypemoErrorOptions & { readonly errorLabels?: readonly string[] } = {},
  ) {
    super(message, options);
    this.failure = failure;
    this.errorLabels = Object.freeze([...(options.errorLabels ?? [])]);
  }

  static {
    Object.defineProperty(ConnectionError.prototype, "name", {
      value: "ConnectionError",
      writable: true,
      configurable: true,
    });
  }
}
