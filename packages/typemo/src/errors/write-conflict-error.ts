import { ServerError } from "./server-error.ts";

/**
 * Two transactions (or a transaction and a write) touched the same document (server code 112). Inside
 * `connection.transaction()` the driver retries it (`TransientTransactionError`); it reaches the caller
 * only when the retries are exhausted or outside `transaction()`.
 */
export class WriteConflictError extends ServerError {
  /* `name` lives on the prototype, so instances do not carry it as an own enumerable key. */
  static {
    Object.defineProperty(WriteConflictError.prototype, "name", {
      value: "WriteConflictError",
      writable: true,
      configurable: true,
    });
  }
}
