import type { ChangeStream, ClientSession, IndexDescriptionInfo } from "mongodb";
import type { AggregatePlan, PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { Pipeline } from "../aggregate/pipeline/pipeline.ts";
import type {
  PipelineBuilder,
  PipelineState,
  RowOf,
  SealedPipeline,
  StagedPipeline,
  TerminalPipeline,
} from "../aggregate/pipeline/pipeline-builder.ts";
import { PipelineSources } from "../aggregate/pipeline/pipeline-source.ts";
import type { PipelineDoc } from "../aggregate/types/doc-shape.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import type { ChangeEvent, ModelWatchOptions } from "../change-streams/change-events.ts";
import { ChangeStreams } from "../change-streams/change-streams.ts";
import { ModelChangeStream } from "../change-streams/model-change-stream.ts";
import { CollectionGuard } from "../collections/collection-guard.ts";
import {
  CollectionManager,
  type EnsureCollectionOptions,
  type EnsureCollectionReport,
} from "../collections/collection-manager.ts";
import type { Connection } from "../connection/connection.ts";
import { ConnectionInternals } from "../connection/connection-internals.ts";
import { DocumentSave } from "../document/document-save.ts";
import type { HydratedDoc, SavableDocument, SaveOptions } from "../document/document-types.ts";
import { Documents } from "../document/documents.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import { QueryError } from "../errors/query-error.ts";
import { ValidationError } from "../errors/validation-error.ts";
import { BulkUnits } from "../hooks/bulk-unit-hooks.ts";
import { DocumentHooks } from "../hooks/document-hooks.ts";
import { DriverExecutor } from "../operation/executor/driver-executor.ts";
import type {
  AggregateExecutionPlan,
  BulkWritePlan,
  ExecutionPlan,
  WatchPlan,
} from "../operation/pipeline/execution-plan.ts";
import type { DocumentWrite, OperationContext, OperationTarget } from "../operation/pipeline/operation-context.ts";
import type { StepName } from "../operation/pipeline/operation-step.ts";
import { IssueCollector } from "../operation/steps/value-validator.ts";
import { Keyset, type KeysetPage, type KeysetSort } from "../pagination/keyset.ts";
import { PolicyContext, type PolicyValues } from "../policies/policy-context.ts";
import { ModelOperations, type UpsertFound } from "../query/model-operations.ts";
import type { FindPlan, PlanOptions, PlanWriteConcern } from "../query/plan.ts";
import { PlanValues } from "../query/plan-values.ts";
import type { QueryBuilder } from "../query/query-builder.ts";
import { QuerySpecs } from "../query/query-specs.ts";
import type { CompiledSchema, SchemaInfo } from "../schema/compiler/compiled-schema.ts";
import { SchemaCompiler } from "../schema/compiler/schema-compiler.ts";
import { SchemaWalker } from "../schema/compiler/schema-walker.ts";
import type { PluginStatics, SchemaPlugin } from "../schema/metadata/metadata-types.ts";
import type { EntityClass } from "../schema/options/type-spec.ts";
import { StandardSchema, type StandardSchemaProps } from "../schema/standard-schema/standard-schema.ts";
import type { CreateInput, DataFields, IdInputOf } from "../types/document-forms.ts";
import type { Filter } from "../types/filter.ts";
import type { NoNarrowing } from "../types/narrow.ts";
import type { FilterCheck } from "../types/path-check.ts";
import type { HiddenPaths } from "../types/projection.ts";
import type { ResultDoc } from "../types/result.ts";
import type { FindOneAndUpdateOptions, Update, UpdateCheck } from "../types/update.ts";
import { AggregateQuery } from "./aggregate-query.ts";
import { type BulkWriteOperation, BulkWritePlanner, type BulkWriteResultOf } from "./bulk-write.ts";
import {
  type IndexDiff,
  type IndexSyncResult,
  ModelIndexes,
  type SearchIndexDiff,
  type SearchIndexSyncResult,
} from "./model-indexes.ts";
import { ModelInternals } from "./model-internals.ts";
import { PipelineExecutor } from "./pipeline-executor.ts";

/*
 * The model: an ES class bound to an entity and a connection. The typed query and write entry points come
 * from `ModelOperations`; the model runs their plans through the connection's operation pipeline and adds
 * what has no builder: inserts, `bulkWrite`, aggregation, change streams, POJO utilities, indexes and the
 * collection.
 *
 * "Statics" in Mongoose terms are the methods of a model object here: the document is an instance of
 * the ENTITY class, so the model is not the document's class.
 */

/**
 * Options of the writes without a builder (`create`, `insertOne`, …).
 *
 * @example
 * ```ts
 * const options: WriteOptions = { session, timeoutMS: 5_000, comment: "import" };
 * await Users.insertOne({ name: "Ann" }, options);
 * ```
 */
export interface WriteOptions {
  /** An explicit session; `null` runs outside the ambient transaction; absent = the ambient one. */
  readonly session?: ClientSession | null;
  /** Client-side operation timeout (driver CSOT). */
  readonly timeoutMS?: number;
  /** A comment for the profiler and the logs. */
  readonly comment?: string;
  /** Write concern. Inside a transaction the transaction's applies, so a per-operation one is an error. */
  readonly writeConcern?: PlanWriteConcern;
  /** The policy context of this write (tenant, actor, soft delete), over the ambient scope. */
  readonly policy?: PolicyValues;
}

/**
 * Options of `insertMany`.
 *
 * @example
 * ```ts
 * await Users.insertMany([{ name: "Ann" }, { name: "Bob" }], { ordered: false });
 * ```
 */
export interface InsertManyOptions extends WriteOptions {
  /** `true` (default): stop at the first failing document. `false`: insert every valid document, report the rest. */
  readonly ordered?: boolean;
}

/**
 * Options of `bulkWrite`.
 *
 * @example
 * ```ts
 * await Users.bulkWrite([{ deleteOne: { filter: { name: "Ann" } } }], { ordered: false });
 * ```
 */
export interface BulkWriteOptions extends WriteOptions {
  /** `true` (default): stop at the first failing operation. */
  readonly ordered?: boolean;
}

/**
 * Options of `aggregate`.
 *
 * @example
 * ```ts
 * const rows = await Users.aggregate((p) => p.match({ active: true }), { timeoutMS: 10_000 });
 * ```
 */
export interface ModelAggregateOptions {
  /** An explicit session; `null` runs outside the ambient transaction. */
  readonly session?: ClientSession | null;
  /** Client-side operation timeout (driver CSOT). */
  readonly timeoutMS?: number;
  /** The policy context of this aggregation (tenant, soft delete view), over the ambient scope. */
  readonly policy?: PolicyValues;
}

/**
 * What the callback of `aggregate(build)` returns: a staged pipeline, or one ending in `$out`/`$merge`.
 *
 * @example
 * ```ts
 * const build = (p: PipelineBuilder<PipelineDoc<User>, "collection", "empty">): AggregateResult =>
 *   p.match({ active: true });
 * ```
 */
export type AggregateResult = StagedPipeline | TerminalPipeline;

/**
 * The callback of `aggregate(build)`: receives the builder over the stored documents of `T`.
 *
 * @example
 * ```ts
 * const build: AggregateBuild<User, StagedPipeline> = (p) => p.match({ active: true });
 * ```
 */
export type AggregateBuild<T, B extends AggregateResult> = (
  pipeline: PipelineBuilder<PipelineDoc<T>, "collection", "empty">,
) => B;

/**
 * The rows of an aggregation built by a callback (none for `$out`/`$merge`).
 *
 * @example
 * ```ts
 * const build = (p: PipelineBuilder<PipelineDoc<Order>, "collection", "empty">) =>
 *   p.group((f) => ({ _id: f.status, total: fn.sum(f.amount) }));
 * type Row = AggregateRows<ReturnType<typeof build>>; // { _id: string | null; total: number }
 * ```
 */
export type AggregateRows<B> = RowOf<B>;

/**
 * Options of `keysetPage`.
 *
 * @example
 * ```ts
 * const options: KeysetPageOptions<User, { active: true }, false> = {
 *   filter: { active: true },
 *   sort: [["name", 1]],
 *   limit: 20,
 * };
 * ```
 */
export interface KeysetPageOptions<T, F, L extends boolean> {
  /** Which documents (checked against the entity). */
  readonly filter?: F & NoInfer<FilterCheck<T, F>>;
  /** The order: `[field, direction]` pairs of required, non-nullable fields; `_id` is the last tiebreak. */
  readonly sort: KeysetSort<T>;
  /** Rows per page (a positive integer). */
  readonly limit: number;
  /** The `nextCursor` of the previous page (UNTRUSTED input is fine: it is validated); absent for the first page. */
  readonly after?: string | null;
  /** Plain objects instead of hydrated documents. */
  readonly lean?: L;
  /** Runs in this session; `null` outside the ambient transaction. */
  readonly session?: ClientSession | null;
}

/**
 * The change stream pipeline builder of a model (`Model.watch(p => …)`): rows are the driver's events.
 *
 * @example
 * ```ts
 * const build = (p: WatchBuilder<User>) => p.match({ operationType: "insert" });
 * ```
 */
export type WatchBuilder<T extends object> = ReturnType<typeof Pipeline.watch<EntityClass<T>>>;

/**
 * What a `watch` callback returns: a builder with stages, or one sealed by `$changeStreamSplitLargeEvent`.
 *
 * @example
 * ```ts
 * const build = (p: WatchBuilder<User>): WatchResult => p.match({ operationType: "insert" });
 * ```
 */
export type WatchResult = StagedPipeline | SealedPipeline<unknown>;

/**
 * The events of `watch(build, options)`: the typed `ChangeEvent<T, O>` while the pipeline keeps the event
 * shape (`$match` stages), otherwise the pipeline's own rows (as the server sends them).
 *
 * @example
 * ```ts
 * const build = (p: WatchBuilder<User>) => p.match({ operationType: "insert" });
 * type Events = WatchRows<User, ReturnType<typeof build>, {}>; // ChangeEvent<User, {}>
 * ```
 */
export type WatchRows<T extends object, B, O> =
  B extends PipelineBuilder<infer R, "watch", PipelineState>
    ? SameType<R, RowOf<WatchBuilder<T>>> extends true
      ? ChangeEvent<T, O>
      : R
    : B extends SealedPipeline<infer R>
      ? R
      : never;

/**
 * Identity of two types without comparing their structure (`$match` keeps the SAME row type).
 *
 * @example
 * ```ts
 * type Yes = SameType<string, string>; // true
 * type No = SameType<string, "a">; // false
 * ```
 */
type SameType<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;

/**
 * Turns the user's write or aggregate options into plan options.
 *
 * @param options - The options the user passed, if any.
 * @returns Frozen plan options, with the ambient policy scope merged under `options.policy`.
 * @throws {QueryError} When `timeoutMS` is not a valid timeout.
 */
const planOptions = (options: WriteOptions | ModelAggregateOptions | undefined): PlanOptions => {
  /* The ambient policy scope is taken when the operation is built (here), `options.policy` over it. */
  const captured = PolicyContext.current() ?? PolicyContext.EMPTY;
  const policy =
    options?.policy === undefined ? captured : PolicyContext.merge(captured, options.policy, "options.policy");
  if (options === undefined) return Object.freeze(policy === undefined ? {} : { policy });
  const write = options as WriteOptions;
  return Object.freeze({
    ...(policy === undefined ? {} : { policy }),
    ...(options.session === undefined ? {} : { session: options.session }),
    ...(options.timeoutMS === undefined ? {} : { timeoutMS: QuerySpecs.timeoutMS(options.timeoutMS) }),
    ...(write.comment === undefined ? {} : { comment: write.comment }),
    ...(write.writeConcern === undefined ? {} : { writeConcern: Object.freeze({ ...write.writeConcern }) }),
  });
};

/**
 * Checks that a value is a plain object and copies it, so the user's input is never mutated.
 *
 * @param value - The value to check.
 * @param where - The operation name, for the error message.
 * @returns A copy of the object.
 * @throws {QueryError} When the value is not a plain object.
 */
const document = (value: unknown, where: string) => {
  if (!BsonGuards.isPlainObject(value)) throw new QueryError(`${where}: a document (plain object)`);
  return PlanValues.copyObject(value, "", where);
};

/** The model of entity `T` on one connection. */
export class Model<T extends object> extends ModelOperations<T> {
  /** The connection the model is bound to. */
  readonly connection: Connection;
  /**
   * The model as a Standard Schema v1: `validate(input)` is `model.validate` without the
   * exception — the cast value with defaults (`DataFields<T>`) or every issue (paths as segments). Input typed as
   * `CreateInput<T>`. Any Standard-Schema-aware tool accepts the model itself; `.parse(Users)` validates rows by it.
   */
  readonly "~standard": StandardSchemaProps<CreateInput<T>, DataFields<T>>;
  readonly #executor: PipelineExecutor;
  readonly #target: OperationTarget;
  /* The compiled schema is core mechanics; the core reads it through `ModelInternals.schema`. */
  readonly #compiled: CompiledSchema;

  static {
    ModelInternals.install((model) => model.#compiled);
  }

  /**
   * The schema compiled with the connection's context (plugins, naming), read-only: users see the
   * `SchemaInfo` view, not the compiled internals.
   */
  get schema(): SchemaInfo {
    return this.#compiled;
  }

  /**
   * Not for direct use: call `connection.model(Entity)`.
   * @param entity - The entity class.
   * @param connection - The connection the model is bound to.
   * @throws {ConfigurationError} When a plugin static would shadow a member of the model.
   */
  constructor(entity: EntityClass<T>, connection: Connection) {
    const schema = SchemaCompiler.compileModel(entity, ConnectionInternals.compileContext(connection));
    const target: OperationTarget = Object.freeze({
      entity: entity as EntityClass,
      schema,
      collection: schema.collection,
      database: connection.name,
    });
    const executor = new PipelineExecutor(connection, target);
    super(entity, executor);
    this.connection = connection;
    this.#compiled = schema;
    this.#executor = executor;
    this.#target = target;
    this["~standard"] = StandardSchema.of<CreateInput<T>, DataFields<T>>(schema)["~standard"];
    /* The statics plugins added to the schema, bound to this model. A name that is a member of the model
       already would shadow it: an error, not a silent override. */
    for (const [name, fn] of schema.statics) {
      if (name in this) {
        throw new ConfigurationError(`${entity.name}: the plugin static "${name}" would shadow a member of the model`);
      }
      Object.defineProperty(this, name, { value: fn.bind(this as never), enumerable: false, configurable: false });
    }
  }

  /**
   * This model typed with the statics `plugin` adds: `Users.statics(softDeleteTools).restoreAll()`.
   * The plugin must be applied to the model's schema (global, connection or `@Plugin`), else a
   * `ConfigurationError` — the type never promises a static the runtime does not have.
   *
   * @param plugin - The plugin whose statics to expose.
   * @returns This model, typed with the plugin's statics.
   * @throws {ConfigurationError} When the plugin is not applied to this model's schema.
   */
  statics<P extends SchemaPlugin<never, object>>(plugin: P): this & PluginStatics<P> {
    if (!this.#compiled.plugins.includes(plugin.name)) {
      throw new ConfigurationError(`${this.modelName}: plugin "${plugin.name}" is not applied to this model's schema`);
    }
    return this as this & PluginStatics<P>;
  }

  /** The entity class name. */
  get modelName(): string {
    return this.entity.name;
  }

  /** The collection name. */
  get collectionName(): string {
    return this.#compiled.collection;
  }

  /* ---- find and modify by id ---- */

  /**
   * `findOneAndUpdate({ _id: id }, update, options)` — returns the document AFTER the update by default.
   *
   * @param id - The `_id` of the document, or its string form (an `ObjectId` as 24 hex characters, a `UUID` as its string).
   * @param update - The update, checked against the entity.
   * @param options - `findOneAndUpdate` options (`upsert`, `projection`, …).
   * @returns The query builder.
   * @throws {QueryError} When `id` is `null` or `undefined`.
   */
  findByIdAndUpdate<
    const U extends Update<T, true>,
    const O extends FindOneAndUpdateOptions<T, U> = Record<never, never>,
  >(
    id: IdInputOf<T>,
    update: U & NoInfer<UpdateCheck<T, U>>,
    options?: O & NoInfer<FindOneAndUpdateOptions<T, U>>,
  ): QueryBuilder<T, "findOneAndUpdate", undefined, never, false, UpsertFound<O>, NoNarrowing, never> {
    Model.requireId(id, "findByIdAndUpdate");
    const call = this.findOneAndUpdate as unknown as (
      filter: unknown,
      update: unknown,
      options?: unknown,
    ) => { calledAs(method: string): unknown };
    /* cast: the runtime builder names its errors after the called method; the typed builder does not show it */
    return call.call(this, { _id: id }, update, options).calledAs("findByIdAndUpdate") as QueryBuilder<
      T,
      "findOneAndUpdate",
      undefined,
      never,
      false,
      UpsertFound<O>,
      NoNarrowing,
      never
    >;
  }

  /**
   * `findOneAndDelete({ _id: id })`.
   *
   * @param id - The `_id` of the document, or its string form (an `ObjectId` as 24 hex characters, a `UUID` as its string).
   * @returns The query builder.
   * @throws {QueryError} When `id` is `null` or `undefined`.
   */
  findByIdAndDelete(
    id: IdInputOf<T>,
  ): QueryBuilder<T, "findOneAndDelete", undefined, never, false, false, NoNarrowing, never> {
    Model.requireId(id, "findByIdAndDelete");
    const call = this.findOneAndDelete as unknown as (filter: unknown) => { calledAs(method: string): unknown };
    /* cast: the runtime builder names its errors after the called method; the typed builder does not show it */
    return call.call(this, { _id: id }).calledAs("findByIdAndDelete") as QueryBuilder<
      T,
      "findOneAndDelete",
      undefined,
      never,
      false,
      false,
      NoNarrowing,
      never
    >;
  }

  /**
   * Refuses a missing id.
   *
   * @param id - The id to check.
   * @param what - The method name, for the error message.
   * @throws {QueryError} When `id` is `null` or `undefined`.
   */
  private static requireId(id: unknown, what: string): void {
    if (id === undefined || id === null) throw new QueryError(`${what}: an id is required`);
  }

  /* ---- inserts ---- */

  /**
   * A NEW document (not saved): every field cast at once (`CastError`, as everywhere a value enters through a
   * Typemo method), schema defaults applied. The constraints (`required`, `min`, `enum`, validators) are checked by
   * `$validate()` and `$save()`, which also cast the values assigned to the document later.
   * `$save()` inserts it. The hydrated counterpart of Mongoose's `new Model(data)`.
   *
   * @param doc - The initial data.
   * @returns The new, unsaved hydrated document.
   * @throws {CastError} When a field cannot be cast or an unknown key is given.
   */
  new(doc: CreateInput<T>): HydratedDoc<T> {
    return Documents.create(this.connection, this.#compiled, doc) as HydratedDoc<T>;
  }

  /**
   * Creates documents through `save()` (`document.save` hooks, validation, timestamps): one
   * (`→ T`), or several in ONE ordered write (`→ T[]`, like `bulkSave`: one `insertMany`, never parallel saves).
   *
   * @param doc - One document, or a list of documents.
   * @param options - Session, timeout, comment, write concern and policy.
   * @returns The saved document, or the saved documents in input order.
   * @throws {ValidationError} When a document is invalid.
   * @throws {CastError} When building a document fails; the failure is reported as the write's failure, with events.
   */
  create(doc: CreateInput<T>, options?: WriteOptions): Promise<HydratedDoc<T>>;
  create(docs: readonly CreateInput<T>[], options?: WriteOptions): Promise<HydratedDoc<T>[]>;
  async create(input: unknown, options?: WriteOptions): Promise<unknown> {
    return this.#create(input, options, "create");
  }

  /**
   * The body of `create` and `insertOne`: the operation carries the method the user called, so its errors name
   * it (`Account.create`, not the `insertOne`/`bulkWrite` it runs as).
   *
   * @param input - One document, or a list of documents.
   * @param options - Session, timeout, comment, write concern and policy.
   * @param method - The method the user called.
   * @returns The saved document, or the saved documents in input order.
   */
  async #create(input: unknown, options: WriteOptions | undefined, method: "create" | "insertOne"): Promise<unknown> {
    const save: SaveOptions = {
      ...(options?.session === undefined ? {} : { session: options.session }),
      ...(options?.timeoutMS === undefined ? {} : { timeoutMS: options.timeoutMS }),
      ...(options?.policy === undefined ? {} : { policy: options.policy }),
    };
    const extra = {
      method,
      ...(options?.comment === undefined ? {} : { comment: options.comment }),
      ...(options?.writeConcern === undefined ? {} : { writeConcern: Object.freeze({ ...options.writeConcern }) }),
    };
    const model = this as unknown as Model<object>;
    /* A failure building the documents (`CastError`) is the failure of the write operation, with its events. */
    const build = async <D>(make: () => D): Promise<D> => {
      try {
        return make();
      } catch (error) {
        throw await DocumentSave.failedCreate(model, Array.isArray(input), save, extra, error);
      }
    };
    if (Array.isArray(input)) {
      const documents = await build(() => input.map((doc) => this.new(doc as CreateInput<T>)));
      await DocumentSave.bulkSave(model, documents, save, extra);
      return documents;
    }
    const document = await build(() => this.new(input as CreateInput<T>));
    await DocumentSave.save(document, save, extra);
    return document;
  }

  /**
   * Saves documents in ONE ordered `bulkWrite`: each goes through the preparation of `save()`
   * (`document.save` hooks, validation with async validators, versioning, the shard key as read). Documents
   * with nothing to write send nothing; nothing at all — no request, `undefined`.
   *
   * @param documents - The documents to save.
   * @param options - Save options (session, timeout, policy).
   * @returns The bulk result, or `undefined` when nothing had to be written.
   * @throws {QueryError} When `documents` is not a list.
   * @throws {ValidationError} When a document is invalid.
   */
  async bulkSave(
    documents: readonly SavableDocument[],
    options?: SaveOptions,
  ): Promise<BulkWriteResultOf<T> | undefined> {
    if (!Array.isArray(documents)) throw new QueryError("bulkSave: a list of documents");
    return DocumentSave.bulkSave<BulkWriteResultOf<T>>(this as unknown as Model<object>, documents, options);
  }

  /**
   * Inserts one document; returns it hydrated (defaults and `_id` included). The same write as `create(doc)`:
   * whatever creates a document fires its `document.validate` and `document.save` hooks.
   *
   * @param doc - The document to insert.
   * @param options - Session, timeout, comment, write concern and policy.
   * @returns The inserted document.
   * @throws {QueryError} When `doc` is not a plain object.
   * @throws {ValidationError} When the document is invalid.
   * @throws {DuplicateKeyError} When a unique index is violated.
   */
  async insertOne(doc: CreateInput<T>, options?: WriteOptions): Promise<HydratedDoc<T>> {
    document(doc, "insertOne");
    return this.#create(doc, options, "insertOne") as Promise<HydratedDoc<T>>;
  }

  /**
   * Inserts documents in one request. Ordered (default) stops at the first failure; unordered inserts
   * every valid document. Any failure of a write is a `BulkWriteError` (input indexes, server `code` kept, the
   * invalid documents' `ValidationError`s included).
   *
   * Every document fires its `document.validate` and `document.save` hooks, as `create` does (one document
   * after another, before the request); the operation has its own `model.insertMany` event around the request.
   *
   * @param docs - The documents to insert.
   * @param options - `ordered` plus the write options.
   * @returns The inserted documents.
   * @throws {QueryError} When `docs` is not a list or an item is not a plain object.
   * @throws {BulkWriteError} When any document fails.
   */
  async insertMany(docs: readonly CreateInput<T>[], options?: InsertManyOptions): Promise<HydratedDoc<T>[]> {
    if (!Array.isArray(docs)) throw new QueryError("insertMany: a list of documents");
    const inputs = docs.map((doc, index) => document(doc, `insertMany[${index}]`));
    const save: SaveOptions = {
      ...(options?.session === undefined ? {} : { session: options.session }),
      ...(options?.policy === undefined ? {} : { policy: options.policy }),
    };
    /* An empty list still runs the pipeline (no driver call): its hooks fire like any other's. */
    return (await DocumentSave.insertMany(
      this as unknown as Model<object>,
      inputs,
      options?.ordered !== false,
      save,
      planOptions(options),
    )) as HydratedDoc<T>[];
  }

  /**
   * Several writes in one request (typed by the entity; the input is never mutated).
   *
   * Every operation fires the hooks of its standalone counterpart, besides the bulk's own `model.bulkWrite` hooks:
   * an `insertOne` the document's `document.validate` and `document.save` hooks (as `Model.insertOne`), an
   * `updateOne`/`updateMany`/`replaceOne`/`deleteOne`/`deleteMany` its `query.<kind>` hooks (their `this` shows
   * that one operation, `this.bulkIndex` its position; `modify` changes it, `skip` is refused). An upsert fires no
   * document hooks (no document exists before the server answers); its required fields are checked as for a
   * standalone upsert. Pre hooks: the documents' (with their validation), then the operations' in order, then
   * `model.bulkWrite`. Post hooks run after the whole bulk succeeded: `model.bulkWrite`, then per operation in order
   * (a query post hook receives a `BulkOperationResult`: per operation the server reports only the upserted `_id`).
   * When the bulk fails, an operation the server applied (ordered: before the first failure; unordered: without a
   * write error) still ends in its post hooks, every other one in its postError hooks.
   *
   * @param operations - The operations, each with exactly one of `insertOne`, `updateOne`, …
   * @param options - `ordered` plus the write options.
   * @returns The bulk result.
   * @throws {QueryError} When an operation is malformed.
   * @throws {BulkWriteError} When any operation fails.
   * @throws {PostHookError} When a post hook fails after the write succeeded (outside a transaction).
   */
  async bulkWrite(
    operations: readonly BulkWriteOperation<T>[],
    options?: BulkWriteOptions,
  ): Promise<BulkWriteResultOf<T>> {
    const plan: BulkWritePlan = Object.freeze({
      op: "bulkWrite",
      entity: this.entity as EntityClass,
      operations: BulkWritePlanner.plan(operations),
      ordered: options?.ordered !== false,
      options: planOptions(options),
    });
    /* Operations with hooks of their own (documents for the inserts, query hooks for the rest) go through the
       document layer; otherwise the plain path (the same stored result, no hook to run). */
    const schema = this.#compiled;
    const documents =
      plan.operations.some((operation) => "insertOne" in operation) && DocumentSave.documentHooked(schema);
    if (documents || BulkUnits.needed(schema, plan.operations)) {
      const save: SaveOptions = {
        ...(options?.session === undefined ? {} : { session: options.session }),
        ...(options?.policy === undefined ? {} : { policy: options.policy }),
      };
      return (await DocumentSave.bulkWrite(
        this as unknown as Model<object>,
        plan,
        save,
        documents,
      )) as BulkWriteResultOf<T>;
    }
    /* Nothing to write is not an error (Mongoose gh-9131; like insertMany([])): an empty result, no request —
       the executor sends nothing for an empty batch — but through the pipeline, so the `model.bulkWrite`
       hooks fire (Mongoose skipped the post hooks of `bulkWrite([])`). */
    return (await this.#executor.run(plan)) as BulkWriteResultOf<T>;
  }

  /* ---- aggregation and change streams ---- */

  /**
   * An aggregation over the model's collection. `build` receives the pipeline builder over the
   * stored documents; a finished plan of `Pipeline.from(Entity)` is accepted too.
   *
   * @param build - A callback that builds the pipeline, or a finished aggregation plan.
   * @param options - Session, timeout and policy.
   * @returns An awaitable aggregation query typed by its rows.
   * @throws {QueryError} When the argument is neither a callback nor an aggregation plan.
   * @throws {ConfigurationError} When the plan reads another collection than this model's.
   */
  aggregate<B extends AggregateResult>(
    build: AggregateBuild<T, B>,
    options?: ModelAggregateOptions,
  ): AggregateQuery<AggregateRows<B>>;
  aggregate<R>(plan: AggregatePlan<R>, options?: ModelAggregateOptions): AggregateQuery<R>;
  aggregate(input: unknown, options?: ModelAggregateOptions): AggregateQuery<unknown> {
    const plan = (
      typeof input === "function"
        ? /* Sources named in the build compile with this client's extensions. */
          PipelineSources.within(ConnectionInternals.compileContext(this.connection), () =>
            (input as (p: unknown) => { plan(): AggregatePlan<unknown> })(
              Pipeline.from(this.entity as EntityClass),
            ).plan(),
          )
        : input
    ) as AggregatePlan<unknown>;
    if (plan === null || typeof plan !== "object" || plan.op !== "aggregate") {
      throw new QueryError("aggregate: a pipeline callback or an aggregation plan");
    }
    if (plan.target.kind !== "collection") {
      throw new ConfigurationError(
        `${this.modelName}.aggregate: the plan reads ${plan.target.kind === "sessions" ? "config.system.sessions" : "a database"}, not this model's collection "${this.collectionName}"; run it with connection.aggregate(plan) or client.aggregate(plan)`,
      );
    }
    if (plan.target.collection !== this.collectionName) {
      throw new ConfigurationError(
        `${this.modelName}.aggregate: the plan reads "${plan.target.collection}", not this model's collection "${this.collectionName}"`,
      );
    }
    const execution: AggregateExecutionPlan = {
      op: "aggregate",
      entity: this.entity as EntityClass,
      pipeline: plan.pipeline,
      aggregateOptions: plan.options,
      options: planOptions(options),
    };
    return new AggregateQuery(this.#executor, execution);
  }

  /**
   * A change stream of the collection: typed events per operation type (`ChangeEvent<T, O>`),
   * documents lean or hydrated (`hydrate: true`), `fullDocument`/`fullDocumentBeforeChange` typed by the
   * options; a discriminator model sees its own documents and every event it cannot tell.
   * This overload filters by `$match` stages: the events keep their typed shape.
   *
   * @param build - Builds the pipeline from `$match` stages.
   * @param options - Change stream options.
   * @returns The change stream.
   */
  watch<const O extends ModelWatchOptions<HiddenPaths<T>> = Record<never, never>>(
    build: (pipeline: WatchBuilder<T>) => WatchBuilder<T> | PipelineBuilder<RowOf<WatchBuilder<T>>, "watch", "staged">,
    options?: O,
  ): NoInfer<Promise<ModelChangeStream<ChangeEvent<T, O>>>>;
  /**
   * A change stream reshaped by a pipeline (`$project`, `$addFields`, …): the rows are the pipeline's.
   *
   * @param build - Builds the pipeline.
   * @param options - Change stream options.
   * @returns The change stream.
   */
  watch<B extends WatchResult, const O extends ModelWatchOptions<HiddenPaths<T>> = Record<never, never>>(
    build: (pipeline: WatchBuilder<T>) => B,
    options?: O,
  ): NoInfer<Promise<ModelChangeStream<WatchRows<T, B, O>>>>;
  /* The return types are `NoInfer`: with a contextual type — `const s: Promise<…> = M.watch(…)` — the
     compiler would otherwise infer `B`/`O` back through the event types and hit TS2589.
     The options-only overload comes last: an overload whose first parameter is a bare type parameter,
     tried first, leaves a callback argument without its contextual type — `p` would be implicitly any. */
  /**
   * A change stream of every event of the collection.
   *
   * @param options - Change stream options.
   * @returns The change stream.
   * @throws {QueryError} When `options` is not an object.
   */
  watch<const O extends ModelWatchOptions<HiddenPaths<T>> = Record<never, never>>(
    options?: O,
  ): NoInfer<Promise<ModelChangeStream<ChangeEvent<T, O>>>>;
  async watch(first?: unknown, second?: unknown): Promise<ModelChangeStream<unknown>> {
    const build =
      typeof first === "function" ? (first as (p: unknown) => { build(): readonly PipelineStage[] }) : undefined;
    const options = ((build === undefined ? first : second) ?? {}) as ModelWatchOptions;
    if (typeof options !== "object" || options === null) throw new QueryError("watch: options must be an object");
    const stages =
      build === undefined
        ? []
        : PipelineSources.within(ConnectionInternals.compileContext(this.connection), () =>
            build(Pipeline.watch(this.entity as EntityClass<T>)).build(),
          );
    const prepared = ChangeStreams.prepare(this.#compiled, this.connection, stages, options);
    const plan: WatchPlan = Object.freeze({
      op: "watch",
      entity: this.entity as EntityClass,
      pipeline: prepared.pipeline,
      watchOptions: prepared.driverOptions,
      options: Object.freeze({}),
    });
    return ModelChangeStream.open<unknown>((await this.#executor.run(plan)) as ChangeStream, prepared.convert);
  }

  /* ---- keyset pagination ---- */

  /**
   * One page in a total order (the sort keys plus `_id`) and the cursor of the next page: a page
   * costs the same at any depth, and rows added or removed meanwhile never repeat or skip others. An
   * index on the sort keys plus `_id` serves it.
   *
   * @param options - Filter, sort, page size and the cursor of the previous page.
   * @returns The page: its items, the cursor of the next page (`null` at the end) and `hasMore`.
   * @throws {QueryError} When `options` is not an object or the cursor is invalid.
   */
  async keysetPage<F extends Filter<T, true> = Record<never, never>, const L extends boolean = false>(
    options: KeysetPageOptions<T, F, L>,
  ): Promise<KeysetPage<ResultDoc<T, undefined, never, L, NoNarrowing, never>>> {
    if (typeof options !== "object" || options === null) throw new QueryError("keysetPage: options");
    const secrets = this.connection.client.options.keysetSecrets;
    const plan = Keyset.plan(this.#compiled, options, secrets);
    const filter = options.filter as Readonly<Record<string, unknown>> | undefined;
    const conditions = [filter, plan.after].filter(
      (condition): condition is Readonly<Record<string, unknown>> =>
        condition !== undefined && Object.keys(condition).length > 0,
    );
    const combined = conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : { $and: conditions };
    /* The typed builder is used with a filter built here from checked parts (the user filter is typed by
       the signature, the keyset condition by the schema): the casts only bridge the generic `T`. */
    let query = this.find(combined as never)
      .sort(plan.keys as never)
      .limit((plan.limit + 1) as never);
    if (options.session !== undefined) query = query.session(options.session);
    const rows = (options.lean === true ? await query.lean() : await query) as unknown as object[];
    const hasMore = rows.length > plan.limit;
    const items = hasMore ? rows.slice(0, plan.limit) : rows;
    const last = items.at(-1);
    return Object.freeze({
      items: items as ResultDoc<T, undefined, never, L, NoNarrowing, never>[],
      nextCursor: hasMore && last !== undefined ? Keyset.encode(plan.keys, last, secrets) : null,
      hasMore,
    });
  }

  /* ---- POJO utilities ---- */

  /**
   * A document read elsewhere (stored form: database names) as a tracked hydrated document.
   *
   * @param raw - The stored document.
   * @returns The hydrated document; its `init` hooks have run.
   * @throws {QueryError} When `raw` is not a plain object.
   */
  hydrate(raw: Readonly<Record<string, unknown>>): HydratedDoc<T> {
    if (!BsonGuards.isPlainObject(raw)) throw new QueryError("hydrate: a stored document (plain object)");
    const document = Documents.hydrate(this.connection, this.#compiled, raw);
    /* `document.init` hooks run at once (synchronous: an async one is a ConfigurationError). */
    DocumentHooks.initSync(document);
    return document as HydratedDoc<T>;
  }

  /**
   * Casts a plain object by the schema; unknown keys are errors.
   *
   * @param input - The object to cast.
   * @returns The cast fields.
   * @throws {CastError} On the first field that cannot be cast, or on an unknown key.
   */
  castObject(input: unknown): Partial<DataFields<T>> {
    return SchemaWalker.castDocument(this.#compiled, input) as Partial<DataFields<T>>;
  }

  /**
   * Casts and validates a plain object; returns the cast value with defaults.
   *
   * @param input - The object to validate.
   * @returns The cast value with schema defaults applied.
   * @throws {ValidationError} With every issue found, in the order of the schema fields.
   */
  async validate(input: unknown): Promise<DataFields<T>> {
    /* Defaults apply (a required field with a default, like `_id`, is not "missing"); the value returned has them. */
    const result = SchemaWalker.validateDocument(this.#compiled, input, { validate: true, defaults: true });
    await Promise.all(result.pending);
    if (result.issues.length > 0 || result.value === undefined) {
      /* The same order as $validate(): the schema fields, whatever order the (async) validators finished in. */
      throw new ValidationError(IssueCollector.inSchemaOrder(this.#compiled, result.issues));
    }
    return result.value as DataFields<T>;
  }

  /* ---- indexes and collection ---- */

  /**
   * The driver collection of this model.
   *
   * @returns The driver `Collection`.
   */
  #collection() {
    return ConnectionInternals.environment(this.connection).driver.db.collection(this.collectionName);
  }

  /* Indexes belong to the COLLECTION: a discriminator model works with its root schema, whose indexes
     include every discriminator's (scoped by a partial filter on the key). The discriminator's own list
     is unscoped and lacks the root's: syncing it would drop the root's indexes (Mongoose gh-6347). */

  /**
   * Creates the schema's indexes (every failure collected). Only adds: an index the schema no longer declares
   * stays, and an index already there with the same key and options is left as is (the server treats the
   * request as done). To bring the server's indexes to the schema, use `syncIndexes()`.
   *
   * @returns The names of every index of the schema that is on the server after the call — the ones that
   *   existed before included, so the list does not tell which indexes were new (`diffIndexes()` does).
   * @throws {IndexSyncError} When any index could not be created (an index of the same name or key with other
   *   options included); the others are created.
   * @example
   * ```ts
   * const names = await Users.createIndexes(); // ["email_1", …], every index of the schema
   * ```
   */
  async createIndexes(): Promise<readonly string[]> {
    await this.connection.ready();
    await CollectionGuard.beforeIndexes(this.#db(), this.#compiled, `${this.modelName}.createIndexes`);
    return ModelIndexes.create(this.#compiled.root, this.#collection());
  }

  /**
   * The server's indexes of the collection (`[]` when it does not exist).
   *
   * @returns The index descriptions.
   */
  async listIndexes(): Promise<IndexDescriptionInfo[]> {
    await this.connection.ready();
    return DriverExecutor.listIndexes(this.#collection());
  }

  /**
   * What `syncIndexes` would change (collation compared as the server applies it).
   *
   * @returns The indexes to create, drop and modify.
   */
  async diffIndexes(): Promise<IndexDiff> {
    await this.connection.ready();
    return ModelIndexes.diff(this.#compiled.root, this.#collection(), this.#db());
  }

  /**
   * Drops the indexes the schema does not declare and creates the missing ones. `dryRun` only
   * reports. Every failure is collected.
   *
   * @param options - `dryRun` to report without changing the server.
   * @returns What was (or, with `dryRun`, would be) changed.
   * @throws {IndexSyncError} With every index that failed.
   */
  async syncIndexes(options: { readonly dryRun?: boolean } = {}): Promise<IndexSyncResult> {
    await this.connection.ready();
    if (options.dryRun !== true)
      await CollectionGuard.beforeIndexes(this.#db(), this.#compiled, `${this.modelName}.syncIndexes`);
    return ModelIndexes.sync(this.#compiled.root, this.#collection(), options.dryRun === true, this.#db());
  }

  /**
   * What `syncSearchIndexes` would change (Atlas Search / Vector Search indexes of `@SearchIndex`). A server
   * without search (a plain mongod) is an error (`SearchNotEnabled`), not "no indexes".
   *
   * @returns The search indexes to create, update and drop.
   * @throws {ServerError} With code 31082 when the server has no search support.
   */
  async diffSearchIndexes(): Promise<SearchIndexDiff> {
    await this.connection.ready();
    return ModelIndexes.diffSearch(this.#compiled.root, this.#collection());
  }

  /**
   * Creates, updates and drops search indexes to match `@SearchIndex` (every failure collected).
   *
   * @param options - `dryRun` to report without changing the server.
   * @returns What was (or, with `dryRun`, would be) changed.
   * @throws {IndexSyncError} With every index that failed.
   */
  async syncSearchIndexes(options: { readonly dryRun?: boolean } = {}): Promise<SearchIndexSyncResult> {
    await this.connection.ready();
    return ModelIndexes.syncSearch(this.#compiled.root, this.#collection(), options.dryRun === true);
  }

  /**
   * Creates the collection with the schema's options (capped, time series, clustered, validator, collation,
   * pre/post images). `true`: created; `false`: it already exists with these options. Existing
   * with OTHER options is a `CollectionOptionsError` (Mongoose ignored it silently).
   *
   * @returns `true` when the collection was created, `false` when it already matched.
   * @throws {CollectionOptionsError} When the collection exists with other options.
   * @throws {ConfigurationError} When the schema says `autoCreate: false` (Typemo does not create its collection).
   */
  async createCollection(): Promise<boolean> {
    await this.connection.ready();
    const root = this.#compiled.root;
    if (root.options.autoCreate === false) {
      throw new ConfigurationError(
        `${this.modelName}.createCollection: the schema of ${root.name} says autoCreate: false — Typemo does not create the collection "${root.collection}"; create it where it is owned, or remove autoCreate: false`,
      );
    }
    return CollectionManager.create(this.#db(), this.#compiled);
  }

  /**
   * Makes the collection exist with the schema's options: created when missing, compared when it exists;
   * `update: true` changes what `collMod` can change, `dryRun` only reports.
   *
   * @param options - `update` and `dryRun`.
   * @returns What was (or, with `dryRun`, would be) done.
   * @throws {CollectionOptionsError} When options differ and `update` cannot fix them.
   */
  async ensureCollection(options: EnsureCollectionOptions = {}): Promise<EnsureCollectionReport> {
    await this.connection.ready();
    return CollectionManager.ensure(this.#db(), this.#compiled, options);
  }

  /**
   * The driver database of this model's connection.
   *
   * @returns The driver `Db`.
   */
  #db() {
    return ConnectionInternals.environment(this.connection).driver.db;
  }

  /**
   * An explicit session of the connection's client (the caller ends it).
   *
   * @returns A new client session.
   */
  startSession(): Promise<ClientSession> {
    return this.connection.client.startSession();
  }

  /**
   * @internal A document write: the plan runs through this model's pipeline, marked by `document`.
   * @param plan - The plan of the write.
   * @param document - The document write.
   * @returns The operation's result.
   */
  runDocument(plan: ExecutionPlan, document: DocumentWrite): Promise<unknown> {
    return this.#executor.run(plan, "run", undefined, undefined, document);
  }

  /**
   * @internal A document write that failed before its steps could run.
   * @param plan - The plan of the failed write.
   * @param document - The document write.
   * @param error - The failure.
   * @param step - The step that would have run when it failed.
   * @returns The error the operation ended with.
   */
  reportDocumentFailure(
    plan: ExecutionPlan,
    document: DocumentWrite,
    error: unknown,
    step: StepName,
  ): Promise<unknown> {
    return this.#executor.reportFailure(plan, document, error, step);
  }

  /**
   * @internal A populate sub-query: a find or an aggregation of this model through its pipeline
   * (session, policies, sanitize, hooks, instrumentation — the one path), nested under `parent`.
   * @param plan - The sub-query plan.
   * @param parent - The enclosing operation.
   * @param locals - Extra per-operation values.
   * @returns The sub-query's result.
   */
  runPopulation(
    plan: ExecutionPlan,
    parent: OperationContext | undefined,
    locals?: ReadonlyMap<symbol, unknown>,
  ): Promise<unknown> {
    return this.#executor.run(plan, "run", locals, parent);
  }

  /**
   * @internal Whether a document with this `_id` exists (the version check of a failed save).
   * @param id - The `_id`.
   * @param options - Plan options of the save.
   * @returns `true` when the document exists.
   */
  async existsForDocument(id: unknown, options: PlanOptions): Promise<boolean> {
    const plan: FindPlan = Object.freeze({
      op: "findOne",
      entity: this.entity as EntityClass,
      filter: Object.freeze({ _id: id }),
      projection: Object.freeze({ _id: 1 }),
      populate: Object.freeze([]),
      lean: true,
      orFail: false,
      mode: Object.freeze({ kind: "run" }),
      options,
    });
    return (await this.#executor.run(plan)) !== null;
  }

  /**
   * @internal The stored versions of documents by `_id` (`null` without a version key); a missing id is absent.
   * @param ids - The `_id`s to look up.
   * @param versionKey - The schema's version key, if any.
   * @param options - Plan options of the save.
   * @returns The versions keyed by the stringified `_id`.
   */
  async versionsForDocuments(
    ids: readonly unknown[],
    versionKey: string | undefined,
    options: PlanOptions,
  ): Promise<Map<string, number | null>> {
    const plan: FindPlan = Object.freeze({
      op: "find",
      entity: this.entity as EntityClass,
      filter: Object.freeze({ _id: Object.freeze({ $in: Object.freeze([...ids]) }) }),
      projection: Object.freeze(versionKey === undefined ? { _id: 1 } : { _id: 1, [versionKey]: 1 }),
      populate: Object.freeze([]),
      lean: true,
      orFail: false,
      mode: Object.freeze({ kind: "run" }),
      options,
    });
    const rows = (await this.#executor.run(plan)) as readonly Readonly<Record<string, unknown>>[];
    return new Map(
      rows.map((row) => [
        String(row._id),
        versionKey === undefined ? null : ((row[versionKey] as number | undefined) ?? null),
      ]),
    );
  }

  /** @internal The operation target (tests of the pipeline). */
  get target(): OperationTarget {
    return this.#target;
  }
}
