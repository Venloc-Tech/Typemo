import type { OperationErrorEvent } from "@venloc/typemo";

/**
 * The Sentry `contexts.typemo` of a captured error: everything a caller needs to filter and understand the
 * failure in Sentry, without any document data. The index signature is what Sentry's own `Context` type
 * requires (a context is an open record); every field below is still fully typed.
 *
 * @example
 * ```ts
 * const context: TypemoErrorContext = {
 *   model: "User",
 *   collection: "users",
 *   database: "app",
 *   connection: "default",
 *   operation: "findOne",
 *   path: undefined,
 *   failedStep: "execute",
 *   classification: "server",
 *   serverCode: 11000,
 *   errorLabels: [],
 *   retryable: false,
 *   transient: false,
 * };
 * ```
 */
export interface TypemoErrorContext {
  readonly [key: string]: unknown;
  /** The model name; absent for a database-level operation (`connection.aggregate`, `client.aggregate`). */
  readonly model?: string;
  /** The collection name; absent when the operation reads no collection (a whole database, `admin`). */
  readonly collection?: string;
  /** The database name. */
  readonly database: string;
  /** The connection name. */
  readonly connection: string;
  /** The operation name. */
  readonly operation: string;
  /** The populated path of a populate sub-query, else `undefined`. */
  readonly path: string | undefined;
  /** The pipeline step that failed, when known. */
  readonly failedStep: string | undefined;
  /** The error classification kind. */
  readonly classification: string;
  /** The MongoDB server error code, when the failure came from the server. */
  readonly serverCode: number | undefined;
  /** The server error labels. */
  readonly errorLabels: readonly string[];
  /** Whether retrying may help. */
  readonly retryable: boolean;
  /** Whether the failure is transient. */
  readonly transient: boolean;
  /** The operation's tenant; present only with `includeTenant: true` and a tenant-scoped operation. */
  readonly tenant?: string;
}

/** Builds the context and tags Sentry receives with a captured operation error. */
export class ErrorContextBuilder {
  /**
   * The `contexts.typemo` object of an operation error.
   *
   * @param event - The `operation.error` event.
   * @param includeTenant - Whether the operation's tenant goes into the context (`includeTenant` option).
   * @returns The context, holding metadata only (and the tenant when asked for).
   */
  static context(event: OperationErrorEvent, includeTenant = false): TypemoErrorContext {
    const tenant = ErrorContextBuilder.tenantOf(event, includeTenant);
    return {
      ...(event.model === null ? {} : { model: event.model }),
      ...(event.collection === null ? {} : { collection: event.collection }),
      database: event.database,
      connection: event.connection,
      operation: event.operation,
      path: event.populatePath,
      failedStep: event.failedStep,
      classification: event.classification.kind,
      serverCode: event.classification.code,
      errorLabels: event.classification.errorLabels,
      retryable: event.classification.retryable,
      transient: event.classification.transient,
      ...(tenant === undefined ? {} : { tenant }),
    };
  }

  /**
   * Tags: filterable in the Sentry UI without opening the event's context. A database-level operation has no
   * `typemo.model` tag.
   *
   * @param event - The `operation.error` event.
   * @param includeTenant - Whether the operation's tenant becomes the `typemo.tenant` tag (`includeTenant` option).
   * @returns The tag map.
   */
  static tags(event: OperationErrorEvent, includeTenant = false): Record<string, string> {
    const tenant = ErrorContextBuilder.tenantOf(event, includeTenant);
    return {
      "typemo.error_class": event.classification.name,
      "typemo.classification": event.classification.kind,
      "typemo.operation": event.operation,
      ...(event.model === null ? {} : { "typemo.model": event.model }),
      ...(tenant === undefined ? {} : { "typemo.tenant": tenant }),
    };
  }

  /**
   * The tenant as Sentry shows it. The core delivers `tenant` only to subscribers that asked for it; the
   * option is checked here too, so a builder call without it never leaks a tenant.
   *
   * @param event - The `operation.error` event.
   * @param includeTenant - Whether the tenant is wanted.
   * @returns The tenant as a string, or `undefined` when not wanted or the operation has none.
   */
  static tenantOf(event: OperationErrorEvent, includeTenant: boolean): string | undefined {
    if (!includeTenant || event.tenant === undefined || event.tenant === null) return undefined;
    return String(event.tenant);
  }
}
