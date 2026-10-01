import type { Db } from "mongodb";
import type { AggregatePlan } from "../aggregate/pipeline/aggregate-plan.ts";
import { SyncAll, type SyncAllOptions, type SyncReport } from "../collections/sync-all.ts";
import { SyncRunner } from "../collections/sync-runner.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import type { AggregateQuery } from "../model/aggregate-query.ts";
import { DatabaseAggregate } from "../model/database-aggregate.ts";
import { Model, type ModelAggregateOptions } from "../model/model.ts";
import { ModelInternals } from "../model/model-internals.ts";
import type { OperationEnvironment } from "../operation/pipeline/operation-context.ts";
import type { OperationPipeline } from "../operation/pipeline/operation-pipeline.ts";
import { StandardPipeline } from "../operation/pipeline/standard-pipeline.ts";
import { PluginRegistry } from "../plugins/plugin-registry.ts";
import type { CompileContext } from "../schema/compiler/schema-compiler.ts";
import type { EntityClass } from "../schema/options/type-spec.ts";
import { ClientInternals } from "./client-internals.ts";
import { ConnectionInternals } from "./connection-internals.ts";
import type { TransactionOptions } from "./transaction-scope.ts";
import type { TransactionCallback, TypemoClient } from "./typemo-client.ts";

/*
 * A database of a client: the model registry, connection-level plugins and the operation pipeline its models
 * run through. Several connections share one client (`useDb`); closing is the client's (Mongoose's `useDb`
 * children closed the shared client).
 */

/**
 * One database of a `TypemoClient`, with its models.
 *
 * @example
 * ```ts
 * const client = await TypemoClient.connect("mongodb://localhost");
 * const connection = client.db("app");
 * const users = connection.model(User);
 * ```
 */
export class Connection {
  /** The client that owns the driver connection. */
  readonly client: TypemoClient;
  /** The database name. */
  readonly name: string;
  /** Connection-level plugins: applied to this connection's schemas after the global ones. */
  readonly plugins = new PluginRegistry("connection");
  readonly #compileContext: CompileContext;
  readonly #db: Db;
  readonly #models = new Map<EntityClass, Model<object>>();
  #pipeline: OperationPipeline;
  readonly #environment: OperationEnvironment;

  /**
   * Created by `TypemoClient.db()`; not for direct use.
   * @param client - The owning client.
   * @param db - The driver database.
   * @param name - The database name.
   */
  constructor(client: TypemoClient, db: Db, name: string) {
    this.client = client;
    this.#db = db;
    this.name = name;
    this.#compileContext = Object.freeze({ plugins: this.plugins, extensions: ClientInternals.extensions(client) });
    this.#pipeline = StandardPipeline.create();
    this.#environment = Object.freeze({
      ready: (timeoutMS: number | undefined) => ClientInternals.readyIfNeeded(client, timeoutMS),
      driver: Object.freeze({ client: client.unsafeDriver(), db }),
      instrumentation: client.instrumentation,
      connectionName: client.name,
      owner: client,
      linksDriverCommands: () => ClientInternals.linksDriverCommands(client),
      server: client.server,
      validateReads: client.options.validateReads,
      schemaOfCollection: (collection: string) => {
        /* Discriminators share their root's collection: the root schema describes it. */
        const model = [...this.#models.values()].find((candidate) => candidate.collectionName === collection);
        return model === undefined ? undefined : ModelInternals.schema(model).root;
      },
    });
  }

  /*
   * There is no public getter or setter of the pipeline: replacing slots could drop the `policies` slot.
   * The core reaches it through `ConnectionInternals` (not exported from `index.ts`).
   */
  static {
    ConnectionInternals.install({
      get: (connection) => connection.#pipeline,
      environment: (connection) => connection.#environment,
      compileContext: (connection) => connection.#compileContext,
      set: (connection, pipeline) => {
        connection.#pipeline = pipeline;
      },
    });
  }

  /**
   * The model of an entity on this connection (one per entity: the same object on every call).
   *
   * @param entity - The `@Schema` class.
   * @returns The model.
   * @throws {ConfigurationError} When `entity` is not a class.
   */
  model<T extends object>(entity: EntityClass<T>): Model<T> {
    if (typeof entity !== "function") throw new ConfigurationError("connection.model: an entity class (@Schema)");
    let model = this.#models.get(entity as EntityClass);
    if (model === undefined) {
      model = new Model<T>(entity, this) as unknown as Model<object>;
      this.#models.set(entity as EntityClass, model);
    }
    return model as unknown as Model<T>;
  }

  /** The models registered on this connection. */
  get models(): readonly Model<object>[] {
    return [...this.#models.values()];
  }

  /**
   * Brings every collection (options, indexes, search indexes) and view of this connection's models in line
   * with their schemas. One model's failure never stops the others; the failures are thrown together as one
   * `SyncError` (with the full report) after every step ran. `dryRun` only reports.
   *
   * @param options - Sync options (`dryRun`, …).
   * @returns The report of what was created or changed.
   * @throws {SyncError} When some step failed.
   */
  syncAll(options?: SyncAllOptions): Promise<SyncReport> {
    return SyncAll.run(this, options);
  }

  /**
   * Creates what the models and views of this connection need and the database LACKS — collections (with
   * their schema options), indexes, search indexes, views. Explicit, never automatic: call it at start-up or
   * in a deploy step, after registering the models with `model()`. Nothing is dropped or changed: an extra
   * index stays, an index or collection declared differently is a failure (`syncAll()` replaces it). Every
   * step of every model runs.
   *
   * @returns The report: `inSync: true` (the database now has what the models need) and `created` listing
   *   what this call created (empty when nothing was missing).
   * @throws {SyncError} When something failed: `failures` lists them per collection and view, `cause` is an
   *   `AggregateError` of the original errors, `report` the full report.
   */
  init(): Promise<SyncReport> {
    return SyncRunner.run(this, {}, "init");
  }

  /**
   * Runs a database-level aggregation — a plan of `Pipeline.database()` (this connection's database), `Pipeline.admin()` (the `admin`
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
   * const rows = await connection.aggregate(Pipeline.database().documents([{ n: 1 }, { n: 2 }]).plan());
   * ```
   */
  aggregate<R>(plan: AggregatePlan<R>, options?: ModelAggregateOptions): AggregateQuery<R> {
    return DatabaseAggregate.query(this, "connection", plan, options);
  }

  /**
   * Another database of the same client (its own models; closing is the client's).
   *
   * @param name - The database name.
   * @returns The connection of that database.
   */
  useDb(name: string): Connection {
    return this.client.db(name);
  }

  /**
   * Waits until the client is connected.
   *
   * @param timeoutMS - How long to wait; default the client's `readyTimeoutMS`.
   * @throws {TimeoutError} When the client is not connected in time.
   */
  ready(timeoutMS?: number): Promise<void> {
    return this.client.ready(timeoutMS);
  }

  /**
   * A transaction on this connection's client (see `TypemoClient.transaction`). The callback may run again after
   * a transient error: load documents inside it, or change them with an atomic update (`$inc`); a document loaded
   * outside and changed by arithmetic inside (`doc.balance -= 10`) has the change applied twice by a retry.
   *
   * @param fn - The callback; its operations join the transaction by themselves.
   * @param options - Transaction options.
   * @returns What the callback returns, after the commit.
   */
  transaction<R>(fn: TransactionCallback<R>, options?: TransactionOptions): Promise<R> {
    return this.client.transaction(fn, options);
  }
}
