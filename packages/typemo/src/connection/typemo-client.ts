import {
  type ClientSession,
  type ClientSessionOptions,
  type CommandFailedEvent,
  type CommandStartedEvent,
  type CommandSucceededEvent,
  MongoClient,
  ReadConcern,
  type TopologyDescription,
  type TopologyDescriptionChangedEvent,
  WriteConcern,
} from "mongodb";
import type { AggregatePlan } from "../aggregate/pipeline/aggregate-plan.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import { ConnectionError } from "../errors/connection-error.ts";
import { ErrorTranslator } from "../errors/error-translator.ts";
import { ErrorLabels } from "../errors/server-error-codes.ts";
import { TimeoutError } from "../errors/timeout-error.ts";
import type { EmittedEvent } from "../instrumentation/instrumentation-events.ts";
import {
  InstrumentationHub,
  type InstrumentationSubscriber,
  type SubscriberSensitive,
  type Subscription,
} from "../instrumentation/instrumentation-hub.ts";
import { OperationScope } from "../instrumentation/operation-scope.ts";
import type { AggregateQuery } from "../model/aggregate-query.ts";
import { DatabaseAggregate } from "../model/database-aggregate.ts";
import type { ModelAggregateOptions } from "../model/model.ts";
import { SensitiveMask } from "../policies/sensitive-mask.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import { ExtensionRegistry, type TypemoExtension } from "../schema/extensions/extension-registry.ts";
import { ClientInternals } from "./client-internals.ts";
import { ClientOptions, type ResolvedClientOptions, type TypemoClientOptions } from "./client-options.ts";
import { Connection } from "./connection.ts";
import { type ConnectionState, TopologyStates } from "./connection-state.ts";
import { TransactionContext } from "./transaction-context.ts";
import { type TransactionOptions, TransactionScope } from "./transaction-scope.ts";

/*
 * The owner of one `MongoClient`. There is no global singleton: models are bound to a connection of an
 * explicit client. `connect()`/`close()` delegate to the driver; pooling, retries, reconnection, server
 * selection and `withTransaction` retries are the driver's.
 *
 * Readiness: an operation issued before `connect()` WAITS inside the pipeline for the connection, bounded by
 * its `timeoutMS` or the client's `readyTimeoutMS` (default 10 s), then fails with a clear `TimeoutError`.
 * There is no command queue and no replay: the waiting operation itself continues after `connect()`. After
 * the first successful connect the driver handles reconnection.
 */

/** The driver's connection-pool (CMAP) events forwarded to instrumentation as `driver.pool`. */
const CMAP_EVENTS = [
  "connectionPoolCreated",
  "connectionPoolReady",
  "connectionPoolClosed",
  "connectionPoolCleared",
  "connectionCreated",
  "connectionReady",
  "connectionClosed",
  "connectionCheckOutStarted",
  "connectionCheckOutFailed",
  "connectionCheckedOut",
  "connectionCheckedIn",
] as const;

/** A promise with its settle functions. */
class Deferred {
  /** The promise settled by `resolve` / `reject`. */
  readonly promise: Promise<void>;
  /** Fulfils the promise. */
  resolve: () => void = () => {};
  /** Rejects the promise. */
  reject: (error: unknown) => void = () => {};

  /** Creates the promise. */
  constructor() {
    this.promise = new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    /* A rejection nobody waits for is not an unhandled rejection: `connect()` reports it to its caller. */
    this.promise.catch(() => undefined);
  }
}

/**
 * A transaction callback: receives the scope (session, participants); its operations join the transaction
 * by themselves.
 *
 * @example
 * ```ts
 * const callback: TransactionCallback<number> = async (scope) => {
 *   await Users.create({ name: "Ann" });
 *   return scope.attempt;
 * };
 * const attempt = await client.transaction(callback);
 * ```
 */
export type TransactionCallback<R> = (scope: TransactionScope) => Promise<R>;

/**
 * The owner of a `MongoClient`: lifecycle, state, readiness, sessions, transactions, instrumentation.
 *
 * @example
 * ```ts
 * await using client = await TypemoClient.connect("mongodb://localhost:27017/app", { timeoutMS: 30_000 });
 * const Users = client.connection.model(User);
 * ```
 */
export class TypemoClient implements AsyncDisposable {
  /** The validated options (driver's and Typemo's). */
  readonly options: ResolvedClientOptions;
  /** Instrumentation subscribers of this client (plus the global ones). */
  readonly instrumentation: InstrumentationHub;
  readonly #extensions = new ExtensionRegistry("client.use()", ExtensionRegistry.global);
  readonly #client: MongoClient;
  readonly #connections = new Map<string, Connection>();
  readonly #stateListeners = new Set<(state: ConnectionState) => void>();
  #state: ConnectionState = "idle";
  #topology: TopologyDescription | undefined;
  #everConnected = false;
  #connecting: Promise<void> | undefined;
  #ready = new Deferred();
  #driverListeners: { readonly commands: boolean; readonly pool: boolean } = { commands: false, pool: false };
  #warnedMonitoring = false;
  readonly #commandStarts = new Map<
    number,
    { readonly at: number; readonly operationId: number | undefined; readonly schema: CompiledSchema | undefined }
  >();
  readonly #detachHub: () => void;

  /* The core-only members stay `#private`; the core reaches them through `ClientInternals`. */
  static {
    ClientInternals.install({
      extensions: (client) => client.#extensions,
      readyIfNeeded: (client, timeoutMS) => client.#readyIfNeeded(timeoutMS),
      linksDriverCommands: (client) => client.#driverListeners.commands,
      auditTransaction: (client, label, fn, session, options) => client.#auditTransaction(label, fn, session, options),
    });
  }

  /**
   * Creates a client (does not connect). `options` are the driver's `MongoClientOptions` plus Typemo's
   * (`readyTimeoutMS`, `name`); Typemo's BSON options are enforced, the object is not mutated.
   *
   * @param uri - The connection string.
   * @param options - Client options.
   * @throws {ConfigurationError} On an invalid or conflicting option (see `ClientOptions.resolve`).
   */
  constructor(uri: string, options: TypemoClientOptions = {}) {
    this.options = ClientOptions.resolve(uri, options);
    this.#client = new MongoClient(uri, this.options.driver);
    this.instrumentation = new InstrumentationHub(InstrumentationHub.global);
    this.#client.on("topologyDescriptionChanged", (event: TopologyDescriptionChangedEvent) => {
      this.#topology = event.newDescription;
      this.#setState(TopologyStates.next(this.#state, event.newDescription));
    });
    this.#detachHub = this.instrumentation.onChange(() => this.#syncDriverListeners());
    this.#syncDriverListeners();
  }

  /**
   * Creates a client and connects it.
   *
   * @param uri - The connection string.
   * @param options - Client options.
   * @returns The connected client.
   * @throws {ConnectionError} When the connection fails.
   */
  static async connect(uri: string, options: TypemoClientOptions = {}): Promise<TypemoClient> {
    const client = new TypemoClient(uri, options);
    await client.connect();
    return client;
  }

  /** The client's name in events. */
  get name(): string {
    return this.options.name;
  }

  /** The current state (from the driver's topology events). */
  get state(): ConnectionState {
    return this.#state;
  }

  /**
   * **Unsafe exit to the raw driver** `MongoClient`, for what Typemo does not wrap (admin commands, GridFS, …).
   * Everything done through it bypasses Typemo entirely: tenant isolation, soft delete, `Hidden` fields,
   * `sensitive` masking, audit, hooks and instrumentation events. Operations of models never use it.
   * It is a named method, not a getter, so the bypass is explicit at the call site.
   *
   * @returns The driver client.
   */
  unsafeDriver(): MongoClient {
    return this.#client;
  }

  /**
   * The first host of the connection string (instrumentation: `server.address`/`server.port`). Read
   * once from the parsed options: no per-operation cost. A replica set or a mongos list reports its first seed;
   * the exact server of each command is in `driver.command.*` events.
   */
  get server(): { readonly address: string; readonly port: number | undefined } | undefined {
    if (this.#server === null) {
      const host = this.#client.options.hosts[0];
      const address = host?.host ?? host?.socketPath;
      this.#server = address === undefined ? undefined : Object.freeze({ address, port: host?.port });
    }
    return this.#server;
  }

  /** Cache of {@link server}: `null` = not read yet, `undefined` = the string names no host. */
  #server: { readonly address: string; readonly port: number | undefined } | undefined | null = null;

  /** The connection to the default database (`dbName` option, the URI's database, else `"test"`). */
  get connection(): Connection {
    return this.db(this.options.dbName);
  }

  /**
   * Runs a database-level aggregation — a plan of `Pipeline.database()` (the client's default database), `Pipeline.admin()` (the `admin`
   * database) or `Pipeline.sessions()` (`config.system.sessions`) — through the operation pipeline, like a
   * model's aggregation: instrumentation events (`model: null`), the ambient transaction, `timeoutMS`, Typemo
   * errors, and the policies of the models it joins (`$lookup`, `$unionWith`). No hooks run: hooks belong to
   * models. A plan of `Pipeline.from(Entity)` runs with the model's `aggregate`.
   *
   * @typeParam R - The row type of the plan.
   * @param plan - The plan (`.plan()` of the builder).
   * @param options - Session, timeout and policy.
   * @returns The awaitable aggregation (`cursor()`, `explain()`, `plain()`, …) typed by the plan's rows.
   * @throws {QueryError} When the argument is not an aggregation plan.
   * @throws {ConfigurationError} When the plan reads a model's collection.
   * @example
   * ```ts
   * const rows = await client.aggregate(Pipeline.database().documents([{ n: 1 }, { n: 2 }]).plan());
   * ```
   */
  aggregate<R>(plan: AggregatePlan<R>, options?: ModelAggregateOptions): AggregateQuery<R> {
    return DatabaseAggregate.query(this.connection, "client", plan, options);
  }

  /**
   * The connection to a database of this client (cached: the same object for the same name).
   *
   * @param name - The database name; default the client's default database.
   * @returns The connection.
   * @throws {ConfigurationError} When the name is not a non-empty string.
   */
  db(name: string = this.options.dbName): Connection {
    if (typeof name !== "string" || name === "") throw new ConfigurationError("TypemoClient.db: a database name");
    let connection = this.#connections.get(name);
    if (connection === undefined) {
      connection = new Connection(this, this.#client.db(name), name);
      this.#connections.set(name, connection);
    }
    return connection;
  }

  /**
   * Subscribes to state changes.
   *
   * @param listener - Called with the new state after each change.
   * @returns The function that unsubscribes.
   */
  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  /**
   * Connects (idempotent while connecting or connected). Operations waiting for readiness continue.
   *
   * @returns This client.
   * @throws {ConnectionError} When the client is closed or the connection fails.
   */
  async connect(): Promise<this> {
    if (this.#state === "closed") {
      throw new ConnectionError("closed", `TypemoClient "${this.name}" is closed; create a new client`);
    }
    if (this.#everConnected) return this;
    this.#connecting ??= this.#connect();
    await this.#connecting;
    return this;
  }

  /**
   * Connects the driver and settles the readiness promise.
   *
   * @throws {ConnectionError} The classified connect error.
   */
  async #connect(): Promise<void> {
    this.#setState("connecting");
    try {
      await this.#client.connect();
      this.#everConnected = true;
      this.#setState(this.#state === "connecting" ? "connected" : this.#state);
      this.#ready.resolve();
    } catch (error) {
      const wrapped = ErrorTranslator.wrap(error);
      this.#setState("idle");
      this.#ready.reject(wrapped);
      this.#ready = new Deferred();
      throw wrapped;
    } finally {
      this.#connecting = undefined;
    }
  }

  /**
   * The operation pipeline's wait: nothing to wait for — no promise, no tick — once the client has
   * connected; the same checks and the same wait as {@link ready} otherwise.
   *
   * @param timeoutMS - The operation's own `timeoutMS`, if any.
   * @returns `undefined` when the client is ready already, else the promise to wait for.
   */
  #readyIfNeeded(timeoutMS: number | undefined): Promise<void> | undefined {
    if (this.#everConnected && this.#state !== "closed") return undefined;
    return this.ready(timeoutMS);
  }

  /**
   * Waits until the client is connected: at once when it is; otherwise until `connect()` succeeds, at most
   * `timeoutMS` (else the client's `readyTimeoutMS`; `0` = no limit).
   *
   * @param timeoutMS - How long to wait.
   * @throws {ConnectionError} With kind `closed` after `close()`, or the connect error when `connect()` fails.
   * @throws {TimeoutError} With kind `connection` when the time runs out.
   */
  async ready(timeoutMS?: number): Promise<void> {
    if (this.#state === "closed") {
      throw new ConnectionError("closed", `TypemoClient "${this.name}" is closed; create a new client`);
    }
    if (this.#everConnected) return;
    const limit = timeoutMS ?? this.options.readyTimeoutMS;
    if (limit === 0) return this.#ready.promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new TimeoutError(
            "connection",
            `TypemoClient "${this.name}" is not connected after ${limit} ms: call connect() (operations issued before connect() wait for it)`,
            { timeoutMS: limit },
          ),
        );
      }, limit);
    });
    try {
      await Promise.race([this.#ready.promise, timeout]);
    } finally {
      /* No timer outlives the wait (Mongoose: dangling buffer timers kept processes alive). */
      clearTimeout(timer);
    }
  }

  /**
   * Closes the client (the driver ends sessions, aborts transactions in progress and closes pools).
   * Waiting operations fail with `ConnectionError("closed")`. Idempotent.
   *
   * @param force - Passed to the driver's `close`: close even with operations in progress.
   */
  async close(force = false): Promise<void> {
    if (this.#state === "closed") return;
    const wasConnecting = this.#connecting;
    this.#setState("closed");
    this.#ready.reject(new ConnectionError("closed", `TypemoClient "${this.name}" was closed`));
    this.#detachHub();
    await wasConnecting?.catch(() => undefined);
    await this.#client.close(force);
  }

  /** `await using client = new TypemoClient(…)` closes it at the end of the scope. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /**
   * Starts an explicit session (after the client is ready). The caller ends it (`endSession()`).
   *
   * @param options - Driver session options.
   * @returns The driver session.
   * @throws {ConnectionError} When the client is closed or cannot connect.
   * @throws {TimeoutError} When the client is not connected in time.
   */
  async startSession(options?: ClientSessionOptions): Promise<ClientSession> {
    await this.ready();
    return this.#client.startSession(options);
  }

  /**
   * Registers a schema extension for THIS client's models: its key becomes valid in `ext` of
   * `@Prop`/`@Schema` for them, its validators check every value at compile. Call it before the first model
   * of this client is compiled.
   *
   * @param extension - The extension to register.
   * @throws {ConfigurationError} When the name is registered already (here or globally with `Typemo.use()`).
   */
  use(extension: TypemoExtension): void {
    this.#extensions.use(extension);
  }

  /**
   * Registers an instrumentation subscriber for this client's operations.
   *
   * @param subscriber - The subscriber.
   * @returns The subscription: `unsubscribe()` removes the subscriber (a second call does nothing); it is also
   *   `Disposable`, so `using subscription = client.instrument(subscriber)` removes it at the end of the scope.
   * @throws {ConfigurationError} When the subscriber wants driver command events and the client was created
   *   without `monitorCommands: true`.
   */
  instrument(subscriber: InstrumentationSubscriber): Subscription {
    if (subscriber?.driverCommands === true && this.options.driver.monitorCommands !== true) {
      throw new ConfigurationError(
        `TypemoClient "${this.name}": driver command events need the client option monitorCommands: true`,
      );
    }
    return this.instrumentation.subscribe(subscriber);
  }

  /**
   * Runs `fn` in a transaction on top of the driver's `withTransaction` (its retries are not repeated
   * here). Every operation inside `fn` joins the transaction through `AsyncLocalStorage` (no `session` to
   * pass); operations of the same session must run one after another. Between retries the participants of
   * the failed attempt are rolled back (`TransactionScope`). Transactions do not nest (MongoDB has none).
   *
   * The callback may run more than once (a transient error retries it), so it must be safe to run again. A document
   * LOADED OUTSIDE the callback and changed inside it is a trap: the rollback between attempts puts a document back
   * to its state at the moment of its `$save()`, and the assignment made just before it is part of that state, so
   * the retry applies the change a second time (`balance` 100 → 90 in the failed attempt, 90 → 80 in the retry,
   * saved: 80).
   * Load the documents INSIDE the callback (each attempt reads them afresh), or change them with an atomic update
   * (`updateOne({ _id }, { $inc: { balance: -10 } })`) that does not depend on the object's memory. Assigning a
   * fixed value (`doc.status = "closed"`) is the same on every attempt and harmless.
   *
   * @param fn - The callback; it may run more than once.
   * @param options - Transaction options.
   * @returns What the callback returns, after the commit.
   * @throws {ConfigurationError} When called inside a transaction of this client, or when the server is a
   *   standalone `mongod` (checked before anything is written).
   * @throws {TypemoError} The callback's error or the commit error, classified.
   */
  async transaction<R>(fn: TransactionCallback<R>, options: TransactionOptions = {}): Promise<R> {
    const ambient = TransactionContext.current();
    if (ambient !== undefined && ambient.owner === this) {
      throw new ConfigurationError(
        "transaction(): transactions do not nest (already inside a transaction of this client)",
      );
    }
    await this.ready(options.timeoutMS);
    const refuse = (cause?: unknown): ConfigurationError =>
      new ConfigurationError(
        `TypemoClient "${this.name}": transaction(): transactions need a replica set or a sharded cluster; this server is a standalone mongod. Run MongoDB as a replica set (a single-member one is enough).`,
        cause === undefined ? undefined : { cause },
      );
    if (this.supportsTransactions === false) throw refuse();
    try {
      return await this.#transact(this.#client.startSession(), true, fn, options);
    } catch (error) {
      /* The topology was not known yet (or changed): the server refuses the transaction itself. */
      if (TopologyStates.isNoTransactionsError(ErrorTranslator.driverCause(error))) throw refuse(error);
      throw error;
    }
  }

  /**
   * The transaction of THIS client that the current async context runs in: `undefined` outside `transaction()`,
   * and also inside a transaction of another client (its operations would not join it). Lets a wrapper decide
   * between opening a transaction and running inside the open one, since transactions do not nest.
   *
   * @returns The ambient transaction of this client, or `undefined`.
   * @example
   * ```ts
   * const inside = client.currentTransaction() !== undefined;
   * ```
   */
  currentTransaction(): TransactionScope | undefined {
    const scope = TransactionContext.current();
    return scope !== undefined && scope.owner === this ? scope : undefined;
  }

  /**
   * Whether the topology supports transactions: `true` for a replica set (a member reached directly
   * included), a sharded cluster or a load balancer; `false` for a standalone `mongod`; `undefined` while
   * unknown (not connected).
   */
  get supportsTransactions(): boolean | undefined {
    return this.#topology === undefined ? undefined : TopologyStates.supportsTransactions(this.#topology);
  }

  /**
   * An audited write called outside a transaction runs in its own transaction, so that the write
   * and its audit entry commit together (or not at all). **A replica set (or a sharded cluster) is
   * required**: on a standalone `mongod` this fails with a clear error before anything is written.
   *
   * @param label - The operation name, used in the error message.
   * @param fn - The callback that performs the write.
   * @param session - The operation's explicit session (not in a transaction), used for the transaction;
   *   else a new one is started.
   * @param options - Transaction options.
   * @returns What the callback returns.
   * @throws {ConfigurationError} When the server is a standalone `mongod`.
   */
  async #auditTransaction<R>(
    label: string,
    fn: TransactionCallback<R>,
    session: ClientSession | undefined,
    options: TransactionOptions,
  ): Promise<R> {
    await this.ready(options.timeoutMS);
    const refuse = (cause?: unknown): ConfigurationError =>
      new ConfigurationError(
        `${label}: the model is audited (@Schema({ audit })); an audited write outside a transaction runs in its own transaction so that the write and its audit entry commit together — this needs a replica set or a sharded cluster, and the server is a standalone mongod. Run MongoDB as a replica set (a single-member one is enough).`,
        cause === undefined ? undefined : { cause },
      );
    if (this.supportsTransactions === false) throw refuse();
    try {
      return await this.#transact(session ?? this.#client.startSession(), session === undefined, fn, options);
    } catch (error) {
      /* The topology was not known yet (or changed): the server refuses the transaction itself. */
      if (TopologyStates.isNoTransactionsError(ErrorTranslator.driverCause(error))) throw refuse(error);
      throw error;
    }
  }

  /**
   * Runs the callback in the driver's `withTransaction`, notifies the participants and emits the
   * transaction events.
   *
   * @param session - The driver session.
   * @param ownsSession - Whether to end the session afterwards.
   * @param fn - The callback.
   * @param options - Transaction options.
   * @returns What the callback returns.
   * @throws {TypemoError} The classified error after the participants were rolled back.
   */
  async #transact<R>(
    session: ClientSession,
    ownsSession: boolean,
    fn: TransactionCallback<R>,
    options: TransactionOptions,
  ): Promise<R> {
    const scope = new TransactionScope(session, this, options.timeoutMS);
    const hub = this.instrumentation;
    const event = (
      type: "transaction.start" | "transaction.commit" | "transaction.abort" | "transaction.retry",
      error?: unknown,
    ) => {
      if (!hub.enabled) return;
      const base = {
        type,
        transactionId: scope.id,
        timestamp: Date.now(),
        attempt: scope.attempt,
        connection: this.name,
        durationMS:
          type === "transaction.commit" || type === "transaction.abort"
            ? performance.now() - scope.startedAt
            : undefined,
      };
      if (error === undefined) {
        hub.emit({ ...base, error: undefined });
        return;
      }
      /* The error is masked like `operation.error` — by the failing operation's schema. */
      const failed = (sensitive: SubscriberSensitive): EmittedEvent => ({
        ...base,
        /* Masked before `emit`, so a failing mask function is reported to the subscribers too. */
        error: hub.reporting(undefined, () => SensitiveMask.transaction(error, sensitive)),
      });
      hub.emit(failed("mask"), hub.wantsValues ? failed : undefined);
    };
    let lastError: unknown;
    try {
      const result = await session.withTransaction(async () => {
        if (scope.attempt > 0) event("transaction.retry", lastError);
        await scope.beginAttempt();
        if (scope.attempt === 1) event("transaction.start");
        try {
          return await TransactionContext.run(scope, () => fn(scope));
        } catch (error) {
          lastError = error;
          /*
           * The driver retries only DRIVER errors labelled TransientTransactionError: hand it the
           * original of a wrapped one, or the retry would silently not happen.
           */
          const cause = ErrorTranslator.driverCause(error);
          throw ErrorTranslator.labelsOf(cause).includes(ErrorLabels.TransientTransactionError) ? cause : error;
        }
      }, TypemoClient.driverTransactionOptions(options));
      await scope.committed();
      event("transaction.commit");
      return result;
    } catch (error) {
      /* With a transaction deadline, an operation inside it cannot set its own (refused): a timeout is the
         transaction's. */
      const wrapped = TimeoutError.withLimit(ErrorTranslator.wrap(error), "transaction", options.timeoutMS);
      await scope.aborted();
      event("transaction.abort", wrapped);
      throw wrapped;
    } finally {
      if (ownsSession) await session.endSession();
    }
  }

  /**
   * Converts the plain transaction options to the driver's.
   *
   * @param options - Typemo's transaction options.
   * @returns The options for `withTransaction`; unset options are omitted.
   */
  private static driverTransactionOptions(options: TransactionOptions) {
    return {
      ...(options.readConcern === undefined ? {} : { readConcern: new ReadConcern(options.readConcern) }),
      ...(options.writeConcern === undefined
        ? {}
        : {
            writeConcern: new WriteConcern(options.writeConcern.w, undefined, options.writeConcern.journal),
          }),
      ...(options.timeoutMS === undefined ? {} : { timeoutMS: options.timeoutMS }),
      ...(options.maxCommitTimeMS === undefined ? {} : { maxCommitTimeMS: options.maxCommitTimeMS }),
    };
  }

  /**
   * Sets the state and notifies the listeners when it changed.
   *
   * @param state - The new state.
   */
  #setState(state: ConnectionState): void {
    if (state === this.#state) return;
    this.#state = state;
    for (const listener of this.#stateListeners) listener(state);
  }

  /**
   * Attaches or detaches the driver command and pool listeners to match what the subscribers ask for; they
   * exist only while a subscriber wants them (zero cost otherwise).
   */
  #syncDriverListeners(): void {
    const hub = this.instrumentation;
    /*
     * Command events exist only with the public client option `monitorCommands: true` (the switch on a
     * live client is driver-internal): without it a subscriber's request is reported, not ignored.
     */
    const monitored = this.options.driver.monitorCommands === true;
    if (hub.wantsDriverCommands && !monitored && !this.#warnedMonitoring) {
      this.#warnedMonitoring = true;
      console.warn(
        `[typemo] TypemoClient "${this.name}": a subscriber asked for driver command events, but the client was created without monitorCommands: true — no driver.command.* events`,
      );
    }
    const commands = hub.wantsDriverCommands && monitored;
    const pool = hub.wantsPoolEvents;
    if (commands !== this.#driverListeners.commands) {
      if (commands) {
        this.#client.on("commandStarted", this.#onCommandStarted);
        this.#client.on("commandSucceeded", this.#onCommandSucceeded);
        this.#client.on("commandFailed", this.#onCommandFailed);
      } else {
        this.#client.off("commandStarted", this.#onCommandStarted);
        this.#client.off("commandSucceeded", this.#onCommandSucceeded);
        this.#client.off("commandFailed", this.#onCommandFailed);
        this.#commandStarts.clear();
      }
    }
    if (pool !== this.#driverListeners.pool) {
      for (const name of CMAP_EVENTS) {
        if (pool) this.#client.on(name, this.#onPoolEvent(name));
        else this.#client.off(name, this.#onPoolEvent(name));
      }
    }
    this.#driverListeners = { commands, pool };
  }

  /** Emits `driver.command.started`. An arrow field because it is passed as a listener and needs `this`. */
  readonly #onCommandStarted = (event: CommandStartedEvent): void => {
    const link = OperationScope.current();
    const operationId = link?.id;
    if (link !== undefined) link.address = event.address;
    this.#commandStarts.set(event.requestId, { at: performance.now(), operationId, schema: link?.schema });
    const base = {
      type: "driver.command.started" as const,
      operationId,
      requestId: event.requestId,
      commandName: event.commandName,
      databaseName: event.databaseName,
      address: event.address,
      timestamp: Date.now(),
      durationMS: undefined,
      failure: undefined,
    };
    /*
     * The subscriber `sensitive` covers unmarked values; the schema marks of the linked operation win.
     * A command no operation issued has no schema to mask by: it is never shown raw.
     */
    const schema = link?.schema;
    const command = (sensitive: SubscriberSensitive): EmittedEvent => ({
      ...base,
      command: SensitiveMask.command(schema, event.command, sensitive),
    });
    this.instrumentation.emit(command("mask"), this.instrumentation.wantsValues ? command : undefined);
  };

  /** Emits `driver.command.succeeded`. An arrow field because it is passed as a listener and needs `this`. */
  readonly #onCommandSucceeded = (event: CommandSucceededEvent): void => {
    this.#commandEnd("driver.command.succeeded", event, undefined);
  };

  /** Emits `driver.command.failed`. An arrow field because it is passed as a listener and needs `this`. */
  readonly #onCommandFailed = (event: CommandFailedEvent): void => {
    this.#commandEnd("driver.command.failed", event, event.failure);
  };

  /**
   * Emits the end event of a driver command, linked to the operation that started it.
   *
   * @param type - The event type.
   * @param event - The driver's command event.
   * @param failure - The driver's failure, `undefined` on success.
   */
  #commandEnd(
    type: "driver.command.succeeded" | "driver.command.failed",
    event: CommandSucceededEvent | CommandFailedEvent,
    failure: unknown,
  ): void {
    const started = this.#commandStarts.get(event.requestId);
    this.#commandStarts.delete(event.requestId);
    const base = {
      type,
      operationId: started?.operationId,
      requestId: event.requestId,
      commandName: event.commandName,
      databaseName: event.databaseName,
      address: event.address,
      timestamp: Date.now(),
      durationMS: event.duration,
      command: undefined,
    };
    if (failure === undefined) {
      this.instrumentation.emit({ ...base, failure });
      return;
    }
    /* The raw driver failure repeats values (errmsg, keyValue, errInfo): only a masked copy is emitted. */
    const schema = started?.schema;
    const failed = (sensitive: SubscriberSensitive): EmittedEvent => ({
      ...base,
      /* Masked before `emit`, so a failing mask function is reported to the subscribers too. */
      failure: this.instrumentation.reporting(undefined, () => SensitiveMask.failure(schema, failure, sensitive)),
    });
    this.instrumentation.emit(failed("mask"), this.instrumentation.wantsValues ? failed : undefined);
  }

  /** One stable handler per CMAP event name, so `off` removes the very function `on` added. */
  readonly #poolHandlers = new Map<string, (event: { readonly address?: string }) => void>();

  /**
   * @param name - The CMAP event name.
   * @returns The handler that emits it as `driver.pool` (the same function on every call for a name).
   */
  #onPoolEvent(name: string): (event: { readonly address?: string }) => void {
    let handler = this.#poolHandlers.get(name);
    if (handler === undefined) {
      handler = (event) =>
        this.instrumentation.emit({
          type: "driver.pool",
          name,
          address: event.address ?? "",
          timestamp: Date.now(),
          event,
        });
      this.#poolHandlers.set(name, handler);
    }
    return handler;
  }
}
