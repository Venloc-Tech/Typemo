import type { ErrorClassification } from "../errors/error-classifier.ts";
import type { ExecutionMode, OperationName } from "../operation/pipeline/execution-plan.ts";
import type { StepName } from "../operation/pipeline/operation-step.ts";
import type { SchemaInfo } from "../schema/compiler/compiled-schema.ts";

/**
 * What every operation event says about the operation. The core emits these events; adapters (OpenTelemetry,
 * Sentry and others) turn them into spans, metrics and breadcrumbs. Every operation event carries the operation id
 * and its parent's id (populate sub-queries), so adapters can nest spans.
 *
 * @example
 * ```ts
 * const label = (info: OperationInfo): string => `${info.model ?? info.database}.${info.operation}`;
 * ```
 */
export interface OperationInfo {
  /** A process-unique id of the operation. */
  readonly operationId: number;
  /** The enclosing operation (a populate sub-query), for nesting. */
  readonly parentId: number | undefined;
  /** The operation name, for example `find` or `updateOne`. */
  readonly operation: OperationName;
  /** How the operation is executed (for example `explain`). */
  readonly mode: ExecutionMode;
  /**
   * The entity class name; `null` for a database-level operation (`connection.aggregate`,
   * `client.aggregate`), which has no model.
   */
  readonly model: string | null;
  /**
   * The collection name; `null` for an aggregation of a whole database or of `admin`, `"system.sessions"`
   * for one of `Pipeline.sessions()`.
   */
  readonly collection: string | null;
  /** The database name (`"admin"` for `Pipeline.admin()`, `"config"` for `Pipeline.sessions()`). */
  readonly database: string;
  /** The connection's name (`TypemoClient` option `name`, default `"default"`). */
  readonly connection: string;
  /** Whether the operation runs inside a transaction. */
  readonly inTransaction: boolean;
  /** The `connection.transaction()` the operation runs in (`TransactionEvent.transactionId`), for nesting. */
  readonly transactionId: number | undefined;
  /**
   * The server the client connects to: the first host of the connection string (`server.address` and
   * `server.port` of OpenTelemetry). The exact server of each command is `DriverCommandEvent.address`.
   */
  readonly serverAddress: string | undefined;
  /** The port of the first host of the connection string. */
  readonly serverPort: number | undefined;
  /** The populated path of a populate sub-query (`parentId` is its operation), else `undefined`. */
  readonly populatePath: string | undefined;
  /**
   * The compiled schema of the model, for integrations (`describe()`, `ext`, `extOf(path)`, `toDbPath`);
   * `null` for a database-level operation. A reference (no copy, nothing computed): an adapter must not
   * serialize the event as a whole.
   */
  readonly schema: SchemaInfo | null;
  /** The tenant (tenant policy), only for subscribers with `includeTenant: true`, because a tenant is data. */
  readonly tenant?: unknown;
}

/**
 * The shape of the operation's input with every value replaced by `"?"`, like OpenTelemetry's
 * `db.query.summary`: keys and operators stay, data does not. With `sensitive: "show"` on the subscriber the
 * values are the real (cast) ones.
 *
 * @example
 * ```ts
 * const summary: OperationSummary = { filter: { age: { $gt: "?" } }, sort: { age: 1 } };
 * ```
 */
export interface OperationSummary {
  /** The filter with its values masked. */
  readonly filter?: unknown;
  /** The update with its values masked. */
  readonly update?: unknown;
  /** The aggregation pipeline with its values masked. */
  readonly pipeline?: unknown;
  /** The projection. */
  readonly projection?: unknown;
  /** The sort. */
  readonly sort?: unknown;
  /** Number of documents (insert) or operations (bulkWrite). */
  readonly count?: number;
}

/**
 * An operation started: emitted before its steps (cast, validation, pre hooks) run, so it also arrives for an
 * operation that then fails before the driver call.
 *
 * @example
 * ```ts
 * const onStart = (event: OperationStartEvent): void => console.log(event.type, event.summary.filter);
 * ```
 */
export interface OperationStartEvent extends OperationInfo {
  /** The event type. */
  readonly type: "operation.start";
  /** When the event happened (ms). */
  readonly timestamp: number;
  /** Computed on first access and cached: an adapter that does not read it pays nothing. */
  readonly summary: OperationSummary;
}

/**
 * An operation finished; for a cursor, when it is exhausted or closed.
 *
 * @example
 * ```ts
 * const onEnd = (event: OperationEndEvent): void => console.log(event.durationMS, event.documentCount);
 * ```
 */
export interface OperationEndEvent extends OperationInfo {
  /** The event type. */
  readonly type: "operation.end";
  /** When the event happened (ms). */
  readonly timestamp: number;
  /** How long the operation took (ms). */
  readonly durationMS: number;
  /** Documents returned, written or matched, when known. */
  readonly documentCount: number | undefined;
}

/**
 * An operation failed in some step; `failedStep` names it.
 *
 * @example
 * ```ts
 * const onError = (event: OperationErrorEvent): void => console.error(event.failedStep, event.error);
 * ```
 */
export interface OperationErrorEvent extends OperationInfo {
  /** The event type. */
  readonly type: "operation.error";
  /** When the event happened (ms). */
  readonly timestamp: number;
  /** How long the operation ran before it failed (ms). */
  readonly durationMS: number;
  /** The step that failed, when known. */
  readonly failedStep: StepName | undefined;
  /** The error as thrown to the caller (a `TypemoError`, or the user's own error from a hook). */
  readonly error: unknown;
  /** What kind of failure it is (retryable, duplicate key and so on). */
  readonly classification: ErrorClassification;
}

/**
 * A nested step of an operation (`cast`, `validate`, `hooksPre`, `hooksPost`, `populate`).
 *
 * @example
 * ```ts
 * const onStep = (event: StepEvent): void => console.log(event.step, event.durationMS);
 * ```
 */
export interface StepEvent {
  /** The event type. */
  readonly type: "operation.step";
  /** The operation the step belongs to. */
  readonly operationId: number;
  /** The step name. */
  readonly step: StepName;
  /** When the event happened (ms). */
  readonly timestamp: number;
  /** How long the step took (ms). */
  readonly durationMS: number;
}

/**
 * A batch delivered by a cursor.
 *
 * @example
 * ```ts
 * const onBatch = (event: CursorBatchEvent): void => console.log(event.batch, event.size);
 * ```
 */
export interface CursorBatchEvent {
  /** The event type. */
  readonly type: "cursor.batch";
  /** The operation that owns the cursor. */
  readonly operationId: number;
  /** When the event happened (ms). */
  readonly timestamp: number;
  /** The number of the batch. */
  readonly batch: number;
  /** The number of documents in the batch. */
  readonly size: number;
}

/**
 * The life of a `connection.transaction()`.
 *
 * @example
 * ```ts
 * const onTransaction = (event: TransactionEvent): void => console.log(event.type, event.attempt);
 * ```
 */
export interface TransactionEvent {
  /** The event type. */
  readonly type: "transaction.start" | "transaction.commit" | "transaction.abort" | "transaction.retry";
  /** A process-unique id of the transaction. */
  readonly transactionId: number;
  /** When the event happened (ms). */
  readonly timestamp: number;
  /** 1 for the first attempt. */
  readonly attempt: number;
  /** The connection's name. */
  readonly connection: string;
  /** Duration since `transaction.start` (commit/abort). */
  readonly durationMS: number | undefined;
  /** The error that caused the retry or the abort. */
  readonly error: unknown;
}

/**
 * A driver command, linked to the Typemo operation that issued it.
 *
 * @example
 * ```ts
 * const onCommand = (event: DriverCommandEvent): void => console.log(event.commandName, event.address);
 * ```
 */
export interface DriverCommandEvent {
  /** The event type. */
  readonly type: "driver.command.started" | "driver.command.succeeded" | "driver.command.failed";
  /** The Typemo operation, `undefined` for commands Typemo did not issue (the driver's own, other code). */
  readonly operationId: number | undefined;
  /** The driver's request id of the command. */
  readonly requestId: number;
  /** The command name, for example `find`. */
  readonly commandName: string;
  /** The database the command ran against. */
  readonly databaseName: string;
  /** `host:port` of the server that ran the command. */
  readonly address: string;
  /** When the event happened (ms). */
  readonly timestamp: number;
  /** How long the command took (ms), on `succeeded` and `failed`. */
  readonly durationMS: number | undefined;
  /** The command, masked like {@link OperationSummary} (only on `started`). */
  readonly command: unknown;
  /** The server error of a failed command. */
  readonly failure: unknown;
}

/**
 * A connection pool event of the driver (CMAP).
 *
 * @example
 * ```ts
 * const onPool = (event: PoolEvent): void => console.log(event.name, event.address);
 * ```
 */
export interface PoolEvent {
  /** The event type. */
  readonly type: "driver.pool";
  /** The CMAP event name (`connectionCheckedOut`, `connectionPoolCleared`, …). */
  readonly name: string;
  /** `host:port` of the server the pool belongs to. */
  readonly address: string;
  /** When the event happened (ms). */
  readonly timestamp: number;
  /** The driver's event object (no user data in CMAP events). */
  readonly event: unknown;
}

/**
 * A failure inside the instrumentation itself that did not stop the operation: a `sensitive` mask function threw
 * on the event path (the value became `"?"`). The error names the path only, never the value.
 *
 * @example
 * ```ts
 * const onFailure = (event: InstrumentationErrorEvent): void => console.warn(event.model, event.path);
 * ```
 */
export interface InstrumentationErrorEvent {
  /** The event type. */
  readonly type: "instrumentation.error";
  /** Where the failure came from. */
  readonly source: "sensitive-mask";
  /** When the event happened (ms). */
  readonly timestamp: number;
  /** The model of the operation whose event was masked, when known. */
  readonly model: string | undefined;
  /** The dotted DB path of the value (empty outside fields). */
  readonly path: string;
  /** The error, with the path only and never the value. */
  readonly error: unknown;
}

/**
 * Every instrumentation event.
 *
 * @example
 * ```ts
 * const onEvent = (event: InstrumentationEvent): void => {
 *   if (event.type === "operation.end") console.log(event.durationMS);
 * };
 * ```
 */
export type InstrumentationEvent =
  | OperationStartEvent
  | OperationEndEvent
  | OperationErrorEvent
  | StepEvent
  | CursorBatchEvent
  | TransactionEvent
  | DriverCommandEvent
  | PoolEvent
  | InstrumentationErrorEvent;

declare const MASKED: unique symbol;

/**
 * An error that went through `SensitiveMask` (`error` and `failure`). `SensitiveMask` is the only producer; a
 * test fails when a cast to this type appears anywhere else. The brand exists only for the type checker: at run
 * time it is the (masked) error itself.
 *
 * Core-only: the core produces it, no public entry exports it.
 *
 * @example
 * ```ts
 * const masked = SensitiveMask.error(error, schema); // MaskedError
 * ```
 */
export type MaskedError = { readonly [MASKED]: true };

/**
 * What the core hands to the hub (`InstrumentationHub.emit`): an event whose error fields are {@link MaskedError},
 * so a new channel cannot pass a raw error to subscribers, because it does not compile. Subscribers receive it as
 * an {@link InstrumentationEvent} (the error typed `unknown`).
 *
 * Core-only: the core builds it, no public entry exports it.
 *
 * @example
 * ```ts
 * hub.emit(event satisfies EmittedEvent);
 * ```
 */
export type EmittedEvent =
  | Exclude<
      InstrumentationEvent,
      OperationErrorEvent | DriverCommandEvent | TransactionEvent | InstrumentationErrorEvent
    >
  | (Omit<InstrumentationErrorEvent, "error"> & { readonly error: MaskedError })
  | (Omit<OperationErrorEvent, "error"> & { readonly error: MaskedError })
  | (Omit<TransactionEvent, "error"> & { readonly error: MaskedError | undefined })
  | (Omit<DriverCommandEvent, "failure"> & { readonly failure: MaskedError | undefined });

/**
 * The `type` of an event.
 *
 * @example
 * ```ts
 * const type: InstrumentationEventType = "operation.start";
 * ```
 */
export type InstrumentationEventType = InstrumentationEvent["type"];
