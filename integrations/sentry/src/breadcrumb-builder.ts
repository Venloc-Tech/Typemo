import type { Breadcrumb } from "@sentry/core";
import type { OperationEndEvent, OperationErrorEvent, OperationSummary, TransactionEvent } from "@venloc/typemo";

/**
 * The `data` every Typemo breadcrumb carries, whatever the outcome. Only masked values are ever included.
 *
 * @example
 * ```ts
 * const data: BreadcrumbData = {
 *   model: "User",
 *   collection: "users",
 *   database: "app",
 *   durationMS: 4,
 *   documentCount: 1,
 *   summary: undefined,
 * };
 * ```
 */
interface BreadcrumbData {
  /** The model name; absent for a database-level operation. */
  readonly model?: string;
  /** The collection name; absent when the operation reads no collection. */
  readonly collection?: string;
  /** The database name. */
  readonly database: string;
  /** Operation duration in milliseconds. */
  readonly durationMS: number;
  /** Documents returned or affected; `undefined` when unknown or on error. */
  readonly documentCount: number | undefined;
  /** The masked summary of the operation, when the core computed one. */
  readonly summary: OperationSummary | undefined;
}

/**
 * Builds the Sentry breadcrumbs of the Typemo adapter: one per operation end or error, in plain
 * language (`Typemo.find (User)`; `Typemo.aggregate (database app)` for a database-level operation), category
 * `typemo`, masked data only, never real values.
 */
export class BreadcrumbBuilder {
  /**
   * `Typemo.<operation> (<Model>)`: the same wording as the OpenTelemetry span name.
   *
   * @param operation - The operation name, for example `find`.
   * @param model - The model name, or `database <name>` for a database-level operation ({@link targetOf}).
   * @returns The breadcrumb message.
   */
  static message(operation: string, model: string): string {
    return `Typemo.${operation} (${model})`;
  }

  /**
   * What the message names: the model, or `database <name>` for a database-level operation (no model).
   *
   * @param event - The operation event.
   * @returns The name shown in parentheses.
   */
  static targetOf(event: OperationEndEvent | OperationErrorEvent): string {
    return event.model ?? `database ${event.database}`;
  }

  /**
   * The breadcrumb of a finished operation.
   *
   * @param event - The `operation.end` event.
   * @param summary - The masked summary taken from `operation.start`, if any.
   * @returns The breadcrumb.
   */
  static forEnd(event: OperationEndEvent, summary: OperationSummary | undefined): Breadcrumb {
    return {
      type: "query",
      category: "typemo",
      level: "info",
      message: BreadcrumbBuilder.message(event.operation, BreadcrumbBuilder.targetOf(event)),
      timestamp: event.timestamp / 1000,
      data: BreadcrumbBuilder.#data(event, summary, event.documentCount),
    };
  }

  /**
   * The breadcrumb of a failed operation.
   *
   * @param event - The `operation.error` event.
   * @param summary - The masked summary taken from `operation.start`, if any.
   * @returns The breadcrumb, with the failed step and the error kind.
   */
  static forError(event: OperationErrorEvent, summary: OperationSummary | undefined): Breadcrumb {
    return {
      type: "error",
      category: "typemo",
      level: "error",
      message: BreadcrumbBuilder.message(event.operation, BreadcrumbBuilder.targetOf(event)),
      timestamp: event.timestamp / 1000,
      data: {
        ...BreadcrumbBuilder.#data(event, summary, undefined),
        failedStep: event.failedStep,
        errorKind: event.classification.kind,
      },
    };
  }

  /**
   * A transaction retry or abort (`Typemo.transaction retry` / `abort`), category `typemo`. Only the error's
   * class name is kept: a driver or server message may quote values.
   *
   * @param event - The `transaction.retry` or `transaction.abort` event.
   * @returns The breadcrumb.
   */
  static forTransaction(event: TransactionEvent): Breadcrumb {
    return {
      type: "transaction",
      category: "typemo",
      level: event.type === "transaction.abort" ? "error" : "warning",
      message: `Typemo.transaction ${event.type.slice("transaction.".length)}`,
      timestamp: event.timestamp / 1000,
      data: {
        transactionId: event.transactionId,
        attempt: event.attempt,
        connection: event.connection,
        durationMS: event.durationMS,
        errorClass: event.error instanceof Error ? event.error.name : undefined,
      },
    };
  }

  /**
   * The data shared by end and error breadcrumbs.
   *
   * @param event - The operation event.
   * @param summary - The masked operation summary.
   * @param documentCount - Documents returned or affected.
   * @returns The common breadcrumb data.
   */
  static #data(
    event: OperationEndEvent | OperationErrorEvent,
    summary: OperationSummary | undefined,
    documentCount: number | undefined,
  ): BreadcrumbData {
    return {
      ...(event.model === null ? {} : { model: event.model }),
      ...(event.collection === null ? {} : { collection: event.collection }),
      database: event.database,
      durationMS: event.durationMS,
      documentCount,
      summary,
    };
  }
}
