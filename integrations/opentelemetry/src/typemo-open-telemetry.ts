import {
  type Attributes,
  type Context,
  context,
  diag,
  type Histogram,
  type MeterProvider,
  metrics,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  type TracerProvider,
  trace,
} from "@opentelemetry/api";
import type {
  CursorBatchEvent,
  DriverCommandEvent,
  InstrumentationErrorEvent,
  InstrumentationEvent,
  InstrumentationSubscriber,
  OperationEndEvent,
  OperationErrorEvent,
  OperationInfo,
  OperationStartEvent,
  StepEvent,
  SubscriberSensitive,
  Subscription,
  TransactionEvent,
} from "@venloc/typemo";
import { PoolMetrics } from "./pool-metrics.ts";
import { SemConv } from "./semconv.ts";

/**
 * A client (`client.instrument`) or the global `Typemo` (`Typemo.instrument`, every client).
 *
 * @example
 * ```ts
 * const target: InstrumentTarget = Typemo;
 * TypemoOpenTelemetry.instrument(target);
 * ```
 */
export interface InstrumentTarget {
  /** Registers a subscriber and returns the handle that removes it. */
  readonly instrument: (subscriber: InstrumentationSubscriber) => Subscription;
}

/**
 * Options of {@link TypemoOpenTelemetry.instrument}.
 *
 * @example
 * ```ts
 * const options: OpenTelemetryOptions = { stepSpans: true, poolMetrics: true, sensitive: "mask" };
 * TypemoOpenTelemetry.instrument(Typemo, options);
 * ```
 */
export interface OpenTelemetryOptions {
  /** Default: the global tracer provider. */
  readonly tracerProvider?: TracerProvider;
  /** Default: the global meter provider. */
  readonly meterProvider?: MeterProvider;
  /** A child span per driver command (needs the client option `monitorCommands: true`). Default `false`. */
  readonly commandSpans?: boolean;
  /** A child span per pipeline step (cast, validate, hooks, populate). Default `false`. */
  readonly stepSpans?: boolean;
  /** Connection pool metrics from the driver's CMAP events. Default `false`. */
  readonly poolMetrics?: boolean;
  /**
   * The core subscriber's `sensitive` for unmarked values: `"mask"` (default, `"?"`), `"show"` (real values,
   * the spans then hold user data), `"hide"` (the whole condition is `"[hidden]"`) or
   * `{ mask: (value, { path }) => json }`. Fields marked `sensitive` in the schema keep their own mode
   * whatever this says. The recorded exception follows it too.
   */
  readonly sensitive?: SubscriberSensitive;
  /** Put the tenant into `typemo.tenant`. Default `false`: a tenant is data. */
  readonly includeTenant?: boolean;
}

const NAME = "@venloc/typemo-opentelemetry";
const VERSION = "0.0.0";

/**
 * A transaction span that is still open.
 *
 * @example
 * ```ts
 * const open: OpenTransaction = { span, callerSpanId: trace.getActiveSpan()?.spanContext().spanId };
 * ```
 */
interface OpenTransaction {
  /** The transaction's span. */
  readonly span: Span;
  /**
   * The span active when the transaction started: the callback's operations nest under the transaction only
   * while it is still the active one (a user span inside the callback wins).
   */
  readonly callerSpanId: string | undefined;
}

/**
 * An operation span that is still open.
 *
 * @example
 * ```ts
 * const open: OpenOperation = { span, attributes: { "db.operation.name": "find" } };
 * ```
 */
interface OpenOperation {
  /** The operation's span. */
  readonly span: Span;
  /** The low-cardinality attributes the duration metric is recorded with. */
  readonly attributes: Attributes;
}

/**
 * JSON of a payload for `db.query.text` (BigInt and BSON values made printable).
 *
 * @param value - The payload.
 * @returns The JSON text, or an empty string when it cannot be serialized.
 */
const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item)) ?? "";
  } catch {
    return "";
  }
};

/**
 * Splits the driver's `host:port` (`[::1]:27017` for IPv6) into the convention's `server.address` and
 * `server.port`, as the operation span has them.
 *
 * @param address - The driver's server address.
 * @returns The span attributes: the host, and the port when the address has one.
 */
const serverAttributes = (address: string): Attributes => {
  const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(address);
  if (match === null) return { [SemConv.SERVER_ADDRESS]: address };
  return {
    [SemConv.SERVER_ADDRESS]: match[1] ?? match[2] ?? address,
    [SemConv.SERVER_PORT]: Number(match[3]),
  };
};

/**
 * The collection a driver command runs on: the value of its first key (the command name) when it is a string.
 * Database-level commands (`aggregate: 1`) and admin commands have none.
 *
 * @param command - The (masked) command document.
 * @returns The collection name, or `undefined`.
 */
const commandCollection = (command: unknown): string | undefined => {
  if (typeof command !== "object" || command === null) return undefined;
  for (const value of Object.values(command)) return typeof value === "string" ? value : undefined;
  return undefined;
};

/** One `instrument()` registration: the subscriber and its span/metric state. */
class OpenTelemetrySubscriber {
  readonly #tracer: Tracer;
  readonly #options: OpenTelemetryOptions;
  readonly #duration: Histogram;
  readonly #pool: PoolMetrics | undefined;
  readonly #operations = new Map<number, OpenOperation>();
  readonly #commands = new Map<number, Span>();
  readonly #transactions = new Map<number, OpenTransaction>();
  /** Per model (model, collection, database, connection): attributes computed once. */
  readonly #modelAttributes = new Map<string, Attributes>();

  /**
   * @param options - Adapter options.
   */
  constructor(options: OpenTelemetryOptions) {
    this.#options = options;
    this.#tracer = (options.tracerProvider ?? trace.getTracerProvider()).getTracer(NAME, VERSION);
    const meter = (options.meterProvider ?? metrics.getMeterProvider()).getMeter(NAME, VERSION);
    this.#duration = meter.createHistogram(SemConv.METRIC_DB_CLIENT_OPERATION_DURATION, {
      unit: "s",
      description: "Duration of database client operations.",
      advice: { explicitBucketBoundaries: [...SemConv.DURATION_BUCKETS] },
    });
    this.#pool = options.poolMetrics === true ? new PoolMetrics(meter) : undefined;
  }

  /**
   * The subscriber object registered with the core.
   *
   * @returns The subscriber, with the event groups the options ask for.
   */
  subscriber(): InstrumentationSubscriber {
    return {
      handle: this.handle,
      wrap: this.wrap,
      sensitive: this.#options.sensitive ?? "mask",
      driverCommands: this.#options.commandSpans === true,
      poolEvents: this.#options.poolMetrics === true,
      steps: this.#options.stepSpans === true,
      includeTenant: this.#options.includeTenant === true,
    };
  }

  /**
   * The operation's span is active for everything the operation does (hooks, populate, driver commands).
   *
   * @param operation - The operation that is about to run.
   * @param run - Runs the operation.
   * @returns The promise of `run`, executed with the operation's span active.
   */
  /* arrow: passed as a callback */
  readonly wrap = (operation: OperationInfo, run: () => Promise<void>): Promise<void> => {
    const open = this.#open(operation);
    return context.with(trace.setSpan(context.active(), open.span), run);
  };

  /**
   * Handles one instrumentation event. Never throws (an adapter must not disturb the operation): failures
   * go to the OpenTelemetry diagnostic logger.
   *
   * @param event - The instrumentation event.
   */
  /* arrow: passed as a callback */
  readonly handle = (event: InstrumentationEvent): void => {
    try {
      switch (event.type) {
        case "operation.start":
          this.#start(event);
          break;
        case "operation.end":
        case "operation.error":
          this.#end(event);
          break;
        case "operation.step":
          this.#step(event);
          break;
        case "cursor.batch":
          this.#batch(event);
          break;
        case "driver.command.started":
        case "driver.command.succeeded":
        case "driver.command.failed":
          this.#command(event);
          break;
        case "driver.pool":
          this.#pool?.record(event);
          break;
        case "instrumentation.error":
          this.#instrumentationError(event);
          break;
        default:
          this.#transaction(event);
      }
    } catch (error) {
      diag.error(`${NAME}: failed to handle "${event.type}"`, error);
    }
  };

  /** Ends the spans still open (an unsubscribed registration leaves no dangling span). */
  close(): void {
    for (const { span } of this.#operations.values()) span.end();
    for (const span of this.#commands.values()) span.end();
    for (const { span } of this.#transactions.values()) span.end();
    this.#operations.clear();
    this.#commands.clear();
    this.#transactions.clear();
  }

  /**
   * A mask function failed while the core shaped an event (the value became "?"). A span event on the active
   * span (the operation's, inside `wrap`), else the OpenTelemetry diagnostic logger. The error carries the
   * path only.
   *
   * @param event - The `instrumentation.error` event.
   */
  #instrumentationError(event: InstrumentationErrorEvent): void {
    const attributes: Attributes = {
      "typemo.instrumentation.source": event.source,
      "typemo.path": event.path,
      ...(event.model === undefined ? {} : { "typemo.model": event.model }),
      ...(event.error instanceof Error ? { "exception.message": event.error.message } : {}),
    };
    const span = trace.getActiveSpan();
    if (span === undefined) diag.warn(`${NAME}: a sensitive mask threw on "${event.path}"; the value is "?"`);
    else span.addEvent("typemo.instrumentation.error", attributes, event.timestamp);
  }

  /**
   * The attributes that depend only on the model, computed once per model. A database-level operation
   * (`connection.aggregate`, `client.aggregate`) has no model, and no collection unless it reads one
   * (`Pipeline.sessions()`): those attributes are left out, not written as empty.
   *
   * @param operation - The operation.
   * @returns Frozen, shared attributes.
   */
  #modelOf(operation: OperationInfo): Attributes {
    const key = `${operation.connection}\u0000${operation.database}\u0000${operation.collection}\u0000${operation.model}`;
    let attributes = this.#modelAttributes.get(key);
    if (attributes === undefined) {
      attributes = Object.freeze({
        [SemConv.DB_SYSTEM_NAME]: SemConv.DB_SYSTEM_NAME_VALUE_MONGODB,
        [SemConv.DB_NAMESPACE]: operation.database,
        ...(operation.collection === null ? {} : { [SemConv.DB_COLLECTION_NAME]: operation.collection }),
        ...(operation.model === null ? {} : { "typemo.model": operation.model }),
      });
      this.#modelAttributes.set(key, attributes);
    }
    return attributes;
  }

  /**
   * The metric/span attributes of an operation (low cardinality: no ids, no values).
   *
   * @param operation - The operation.
   * @returns The attributes.
   */
  #attributesOf(operation: OperationInfo): Attributes {
    return {
      ...this.#modelOf(operation),
      [SemConv.DB_OPERATION_NAME]: operation.operation,
      ...(operation.serverAddress === undefined ? {} : { [SemConv.SERVER_ADDRESS]: operation.serverAddress }),
      ...(operation.serverPort === undefined ? {} : { [SemConv.SERVER_PORT]: operation.serverPort }),
    };
  }

  /**
   * Opens the span of an operation, or returns the one already open.
   *
   * @param operation - The operation.
   * @returns The open operation.
   */
  #open(operation: OperationInfo): OpenOperation {
    const existing = this.#operations.get(operation.operationId);
    if (existing !== undefined) return existing;
    const parentOperation = operation.parentId === undefined ? undefined : this.#operations.get(operation.parentId);
    const transaction =
      operation.transactionId === undefined ? undefined : this.#transactions.get(operation.transactionId);
    const parentSpan =
      parentOperation?.span ??
      (transaction !== undefined && trace.getActiveSpan()?.spanContext().spanId === transaction.callerSpanId
        ? transaction.span
        : undefined);
    const parent: Context = parentSpan === undefined ? context.active() : trace.setSpan(context.active(), parentSpan);
    const attributes = this.#attributesOf(operation);
    /* `Typemo.<operation> (<Model>)`, not the convention's `<operation> <collection>`; a database-level
       operation names its database instead. */
    const name = `Typemo.${operation.operation}${operation.mode === "cursor" ? ".cursor" : ""} (${operation.model ?? `database ${operation.database}`})`;
    const span = this.#tracer.startSpan(
      name,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          ...attributes,
          [SemConv.DB_QUERY_SUMMARY]:
            operation.collection === null ? operation.operation : `${operation.operation} ${operation.collection}`,
          "typemo.operation.mode": operation.mode,
          "typemo.transaction": operation.inTransaction,
          ...(operation.populatePath === undefined ? {} : { "typemo.populate.path": operation.populatePath }),
          ...(operation.tenant === undefined ? {} : { "typemo.tenant": String(operation.tenant) }),
        },
      },
      parent,
    );
    const open = { span, attributes };
    this.#operations.set(operation.operationId, open);
    return open;
  }

  /**
   * Opens the operation span and records the query text.
   *
   * @param event - The `operation.start` event.
   */
  #start(event: OperationStartEvent): void {
    const open = this.#open(event);
    /* `summary` is lazy: read only when it goes into a span. Always written: it is already masked. */
    open.span.setAttribute(SemConv.DB_QUERY_TEXT, stringify(event.summary));
  }

  /**
   * Ends the operation span, sets its outcome and records the duration metric.
   *
   * @param event - The `operation.end` or `operation.error` event.
   */
  #end(event: OperationEndEvent | OperationErrorEvent): void {
    const open = this.#operations.get(event.operationId) ?? this.#open(event);
    this.#operations.delete(event.operationId);
    const { span } = open;
    /* The server of the last command may differ from the one known at the start. */
    const attributes = this.#attributesOf(event);
    if (event.serverAddress !== undefined) span.setAttribute(SemConv.SERVER_ADDRESS, event.serverAddress);
    if (event.serverPort !== undefined) span.setAttribute(SemConv.SERVER_PORT, event.serverPort);
    /* Known only after the context is resolved (the span was opened in `wrap`, before it). */
    span.setAttribute("typemo.transaction", event.inTransaction);
    if (event.type === "operation.end") {
      if (event.documentCount !== undefined) span.setAttribute(SemConv.DB_RESPONSE_RETURNED_ROWS, event.documentCount);
      this.#duration.record(event.durationMS / 1000, attributes);
    } else {
      const errorType = event.classification.name;
      span.setAttribute(SemConv.ERROR_TYPE, errorType);
      if (event.classification.code !== undefined) {
        span.setAttribute(SemConv.DB_RESPONSE_STATUS_CODE, String(event.classification.code));
      }
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorType });
      if (event.error instanceof Error) span.recordException(event.error);
      else span.recordException(String(event.error));
      this.#duration.record(event.durationMS / 1000, { ...attributes, [SemConv.ERROR_TYPE]: errorType });
    }
    span.end();
  }

  /**
   * Adds a child span for a finished pipeline step, back-dated by its duration.
   *
   * @param event - The `operation.step` event.
   */
  #step(event: StepEvent): void {
    const open = this.#operations.get(event.operationId);
    if (open === undefined) return;
    const end = event.timestamp;
    this.#tracer
      .startSpan(
        `Typemo.step ${event.step}`,
        { kind: SpanKind.INTERNAL, startTime: end - event.durationMS, attributes: { "typemo.step": event.step } },
        trace.setSpan(context.active(), open.span),
      )
      .end(end);
  }

  /**
   * Adds a `cursor.batch` event to the operation span.
   *
   * @param event - The `cursor.batch` event.
   */
  #batch(event: CursorBatchEvent): void {
    this.#operations
      .get(event.operationId)
      ?.span.addEvent("cursor.batch", { "typemo.cursor.batch": event.batch, "typemo.cursor.batch.size": event.size });
  }

  /**
   * Starts or ends the span of a driver command.
   *
   * @param event - A `driver.command.*` event.
   */
  #command(event: DriverCommandEvent): void {
    if (event.type === "driver.command.started") {
      const open = event.operationId === undefined ? undefined : this.#operations.get(event.operationId);
      /* Commands no Typemo operation issued (handshakes, monitoring, other code) get no span. */
      if (open === undefined) return;
      const collection = commandCollection(event.command);
      const span = this.#tracer.startSpan(
        event.commandName,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemConv.DB_SYSTEM_NAME]: SemConv.DB_SYSTEM_NAME_VALUE_MONGODB,
            [SemConv.DB_NAMESPACE]: event.databaseName,
            ...(collection === undefined ? {} : { [SemConv.DB_COLLECTION_NAME]: collection }),
            [SemConv.DB_OPERATION_NAME]: event.commandName,
            ...serverAttributes(event.address),
            [SemConv.DB_QUERY_TEXT]: stringify(event.command),
          },
        },
        trace.setSpan(context.active(), open.span),
      );
      this.#commands.set(event.requestId, span);
      return;
    }
    const span = this.#commands.get(event.requestId);
    if (span === undefined) return;
    this.#commands.delete(event.requestId);
    if (event.type === "driver.command.failed") {
      const name = event.failure instanceof Error ? event.failure.name : "Error";
      span.setAttribute(SemConv.ERROR_TYPE, name);
      span.setStatus({ code: SpanStatusCode.ERROR, message: name });
    }
    span.end();
  }

  /**
   * Maintains the span of a transaction: start, retry events, commit or abort.
   *
   * @param event - A `transaction.*` event.
   */
  #transaction(event: TransactionEvent): void {
    if (event.type === "transaction.start") {
      if (this.#transactions.has(event.transactionId)) return;
      this.#transactions.set(event.transactionId, {
        span: this.#tracer.startSpan("Typemo.transaction", {
          kind: SpanKind.INTERNAL,
          attributes: {
            [SemConv.DB_SYSTEM_NAME]: SemConv.DB_SYSTEM_NAME_VALUE_MONGODB,
            "typemo.connection": event.connection,
          },
        }),
        callerSpanId: trace.getActiveSpan()?.spanContext().spanId,
      });
      return;
    }
    const span = this.#transactions.get(event.transactionId)?.span;
    if (span === undefined) return;
    if (event.type === "transaction.retry") {
      span.addEvent("transaction.retry", { "typemo.transaction.attempt": event.attempt });
      return;
    }
    this.#transactions.delete(event.transactionId);
    span.setAttribute("typemo.transaction.attempts", event.attempt);
    if (event.type === "transaction.abort") {
      const name = event.error instanceof Error ? event.error.name : "TransactionAborted";
      span.setAttribute(SemConv.ERROR_TYPE, name);
      span.setStatus({ code: SpanStatusCode.ERROR, message: name });
      if (event.error instanceof Error) span.recordException(event.error);
    }
    span.end();
  }
}

/** The OpenTelemetry adapter of Typemo. */
export class TypemoOpenTelemetry {
  /**
   * Turns the operations of `target` (a client, or the global `Typemo` for every client) into spans and
   * metrics. Register it once per target: two registrations make two spans per operation. Do not combine
   * with `@opentelemetry/instrumentation-mongodb` (it would trace the same commands again).
   *
   * @param target - A client or the global `Typemo`.
   * @param options - Adapter options.
   * @returns The subscription; unsubscribing also ends the spans still open.
   */
  static instrument(target: InstrumentTarget, options: OpenTelemetryOptions = {}): Subscription {
    const adapter = new OpenTelemetrySubscriber(options);
    const subscription = target.instrument(adapter.subscriber());
    const unsubscribe = (): void => {
      subscription.unsubscribe();
      adapter.close();
    };
    return { unsubscribe, [Symbol.dispose]: unsubscribe };
  }
}
