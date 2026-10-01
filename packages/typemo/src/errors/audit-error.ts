import { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";

/**
 * The audit entry of a write could not be written, and a failed audit write FAILS the operation. The entry
 * is written in the operation's transaction, after the write, and this error aborts the transaction: the
 * write and the entry are rolled back together. An audited write called outside a transaction runs in its
 * own transaction, so **a replica set (or a sharded cluster) is required**; on a standalone mongod such a
 * write is a `ConfigurationError`. Hence `applied` is always `false`. `cause` is the failure of the audit write; `operationError` is the
 * operation's own error when it failed too.
 */
export class AuditError extends TypemoError {
  /** The audited model. */
  readonly model: string;
  /** The operation (`updateMany`, `insertMany`, …). */
  readonly operation: string;
  /**
   * Always `false`: the audit entry and the write commit together, so a failed entry rolls the write back and
   * the write is never left in the database by this error.
   */
  readonly applied = false as const;
  /** The error of the operation itself, when it failed in part. */
  readonly operationError: unknown;

  /**
   * @param model - The audited model.
   * @param operation - The operation that was audited.
   * @param options - `cause` (the audit write failure) and the operation's own `operationError`.
   */
  constructor(
    model: string,
    operation: string,
    options: TypemoErrorOptions & { readonly operationError?: unknown } = {},
  ) {
    super(
      `${model}.${operation}: the audit entry could not be written; the transaction is aborted with this error, the write is rolled back`,
      options,
    );
    this.model = model;
    this.operation = operation;
    this.operationError = options.operationError;
  }

  static {
    Object.defineProperty(AuditError.prototype, "name", { value: "AuditError", writable: true, configurable: true });
  }
}
