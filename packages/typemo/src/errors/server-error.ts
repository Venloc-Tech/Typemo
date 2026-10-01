import { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";

/**
 * What a server-side error carries (copied from the driver error, which stays the `cause`).
 *
 * @example
 * ```ts
 * const details: ServerErrorDetails = {
 *   code: 112,
 *   codeName: "WriteConflict",
 *   errorLabels: ["TransientTransactionError"],
 *   cause: new Error("the driver's error"),
 * };
 * ```
 */
export interface ServerErrorDetails extends TypemoErrorOptions {
  /** The server error code, when the driver reports one. */
  readonly code: number | undefined;
  /** The server error code name (`DuplicateKey`, …), when reported. */
  readonly codeName: string | undefined;
  /** The error labels (`TransientTransactionError`, `RetryableWriteError`, …). */
  readonly errorLabels: readonly string[];
  /** The full text of the server, when it differs from the message; the message is used when absent. */
  readonly serverMessage?: string;
}

/**
 * The server (or the driver on its behalf) refused an operation, and no more specific class applies.
 * `code`, `codeName` and `errorLabels` are copied from the driver error; the driver error itself is the
 * `cause` (never mutated, never spread: Mongoose lost `code` that way). The message is short: the reason the
 * server gave plus the code; the full server text (which may hold query plans and values) is in
 * `serverMessage` and in `cause`.
 *
 * @example
 * ```ts
 * try {
 *   await Users.find({}).hint("nope_1");
 * } catch (error) {
 *   if (error instanceof ServerError) console.log(error.message, error.codeName, error.serverMessage);
 * }
 * ```
 */
export class ServerError extends TypemoError {
  /** The server error code. */
  readonly code: number | undefined;
  /** The server error code name. */
  readonly codeName: string | undefined;
  /** The error labels, frozen. */
  readonly errorLabels: readonly string[];
  /** The full server text, as the server sent it (the driver error in `cause` has it too). */
  readonly serverMessage: string;

  /**
   * @param message - Human-readable description.
   * @param details - Code, code name, labels and the optional `cause` copied from the driver error.
   */
  constructor(message: string, details: ServerErrorDetails) {
    super(message, details.cause === undefined ? {} : { cause: details.cause });
    this.code = details.code;
    this.codeName = details.codeName;
    this.errorLabels = Object.freeze([...details.errorLabels]);
    this.serverMessage = details.serverMessage ?? message;
  }

  static {
    Object.defineProperty(ServerError.prototype, "name", { value: "ServerError", writable: true, configurable: true });
  }

  /**
   * Tells whether the error carries a label.
   *
   * @param label - The label to look for (`TransientTransactionError`, `RetryableWriteError`, …).
   * @returns `true` when the label is present.
   */
  hasErrorLabel(label: string): boolean {
    return this.errorLabels.includes(label);
  }
}
