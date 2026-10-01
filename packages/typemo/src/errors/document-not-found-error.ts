import { TypemoError } from "./typemo-error.ts";

/**
 * `orFail()` found no document (a read) or matched none (a write). Carries the operation and the model
 * name. The filter is deliberately NOT kept on the error: it may hold personal data, and Mongoose kept it
 * as `query` and printed it. The instrumentation event has the redacted form.
 */
export class DocumentNotFoundError extends TypemoError {
  /** The operation that found nothing (`findOne`, `updateOne`, …). */
  readonly operation: string;
  /** The model name. */
  readonly model: string;

  /**
   * @param operation - The operation that found nothing.
   * @param model - The model name.
   * @param message - Another text for the same condition (for example a required populate reference).
   */
  constructor(operation: string, model: string, message?: string) {
    super(message ?? `${model}.${operation}: no document matched the filter (orFail)`);
    this.operation = operation;
    this.model = model;
  }

  static {
    Object.defineProperty(DocumentNotFoundError.prototype, "name", {
      value: "DocumentNotFoundError",
      writable: true,
      configurable: true,
    });
  }
}
