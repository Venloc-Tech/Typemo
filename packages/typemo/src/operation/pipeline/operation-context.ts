import type { ClientSession, Db, MongoClient, ReadConcernLevel, ReadPreferenceMode } from "mongodb";
import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import { TypemoError } from "../../errors/typemo-error.ts";
import type { HookEvent, QueryHookEvent } from "../../hooks/hook-events.ts";
import type { StepEvent } from "../../instrumentation/instrumentation-events.ts";
import type { InstrumentationHub } from "../../instrumentation/instrumentation-hub.ts";
import { PolicyContext, type PolicyValues } from "../../policies/policy-context.ts";
import type { PlanDocument, PlanOptions, SortPair } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { EntityClass } from "../../schema/options/type-spec.ts";
import type { BulkWriteModel, ExecutionMode, ExecutionPlan, OperationName } from "./execution-plan.ts";
import type { OperationPipeline } from "./operation-pipeline.ts";
import type { StepName } from "./operation-step.ts";

/* Source of process-unique operation ids. */
let NEXT_OPERATION_ID = 0;

/**
 * The working values the value steps (normalize to validate) rewrite. It is the one list the state before those
 * steps is rebuilt from when a pre hook changed the operation (`OperationContext.snapshotValues`). A new working
 * value must be added here; the type test `test/unit/operation/context-snapshot.test.ts` fails for a mutable field
 * of the context that is in neither this list nor its list of fields the value steps never write.
 */
const VALUE_FIELDS = [
  "filter",
  "update",
  "replacement",
  "documents",
  "operations",
  "pipeline",
  "projection",
  "sort",
  "arrayFilters",
] as const;

/**
 * The name of a working value the value steps rewrite.
 *
 * @example
 * ```ts
 * const field: ValueField = "filter";
 * ```
 */
export type ValueField = (typeof VALUE_FIELDS)[number];

/**
 * The state of an operation before its value steps ran. It is taken when a pre hook first changes the operation
 * (never otherwise, so the normal path pays nothing) and put back before the steps run again.
 *
 * @example
 * ```ts
 * const snapshot: ValuesSnapshot = ctx.snapshotValues();
 * ctx.restoreValues(snapshot);
 * ```
 */
export interface ValuesSnapshot {
  /** The working values as the steps received them: the plan's (no step before `normalize` writes them). */
  readonly values: Readonly<Record<ValueField, unknown>>;
  /** The `locals` entries set before the value steps (the model's, `resolveContext`'s). */
  readonly locals: readonly (readonly [symbol, unknown])[];
  /** Documents left out before the value steps (none in the standard pipeline). */
  readonly rejected: readonly (readonly [number, TypemoError])[];
  /** The control fields a value step writes, as they were before the value steps. */
  readonly flags: DerivedFlags;
}

/**
 * Where a database-level operation (`connection.aggregate`, `client.aggregate`) runs: a whole database, the
 * `admin` database, or the collection `config.system.sessions`.
 *
 * @example
 * ```ts
 * const scope: DatabaseScope = "admin";
 * ```
 */
export type DatabaseScope = "database" | "admin" | "sessions";

/**
 * What the operation works on: the model's entity, its compiled schema and collection. A database-level
 * operation has no model: its `scope` is set, its entity only names the caller in messages and its schema is
 * empty (no fields, hooks or policies of its own; the collections it joins keep theirs).
 *
 * @example
 * ```ts
 * const { entity, schema, collection, database } = ctx.target;
 * ```
 */
export interface OperationTarget {
  /** The entity class of the model. */
  readonly entity: EntityClass;
  /** Compiled with the connection's context (its plugins and naming). */
  readonly schema: CompiledSchema;
  /** The collection name (from the schema; a discriminator shares the root's collection). */
  readonly collection: string;
  /** The database name. */
  readonly database: string;
  /** Set for a database-level operation (no model), `undefined` for a model's operation. */
  readonly scope?: DatabaseScope;
}

/**
 * The connection-side services an operation needs. Implemented by `Connection`.
 *
 * @example
 * ```ts
 * const environment: OperationEnvironment = connection.operationEnvironment;
 * await environment.ready(5000);
 * ```
 */
export interface OperationEnvironment {
  /**
   * Waits until the connection is ready, bounded by `timeoutMS`. Returns `undefined` when it is ready already, so
   * the step stays synchronous in the common case.
   *
   * @param timeoutMS - The longest wait in milliseconds; `undefined` for no bound.
   * @returns A promise to await, or `undefined` when nothing has to be awaited.
   */
  readonly ready: (timeoutMS: number | undefined) => Promise<void> | undefined;
  /** The driver objects. Only `DriverExecutor` and `Connection` may call them. */
  readonly driver: { readonly client: MongoClient; readonly db: Db };
  /** The instrumentation hub (events are emitted only when a subscriber is registered). */
  readonly instrumentation: InstrumentationHub;
  /** The client's name in events. */
  readonly connectionName: string;
  /** The client (an ambient transaction joins only operations of the client that started it). */
  readonly owner: object;
  /**
   * Tells whether a subscriber wants driver commands linked to operations.
   *
   * @returns `true` when driver commands must be linked to the operation.
   */
  readonly linksDriverCommands: () => boolean;
  /** The first host of the connection string (`OperationInfo.serverAddress` and `serverPort`). */
  readonly server?: { readonly address: string; readonly port: number | undefined } | undefined;
  /**
   * The schema of the model registered on this connection for a collection (`$lookup`/`$unionWith` targets).
   *
   * @param collection - The collection name.
   * @returns The compiled schema, or `undefined` when no model of this connection uses that collection.
   */
  readonly schemaOfCollection: (collection: string) => CompiledSchema | undefined;
  /** Whether reads check the stored documents against the schema by default (the client's `validateReads`). */
  readonly validateReads: boolean;
}

/**
 * Why one document of an unordered write was left out.
 *
 * @example
 * ```ts
 * const [first] = ctx.rejected;
 * if (first) console.log(first.index, first.error.message);
 * ```
 */
export interface RejectedDocument {
  /** The index in the user's input (`insertMany` documents / `bulkWrite` operations). */
  readonly index: number;
  /** The error the document was rejected with. */
  readonly error: TypemoError;
}

/**
 * The effective options of an operation after `resolveContext` (the session is resolved separately).
 *
 * @example
 * ```ts
 * const options: ResolvedOptions = { readPreference: "secondary", batchSize: 100 };
 * ```
 */
export interface ResolvedOptions {
  /** The read preference sent to the driver. */
  readonly readPreference?: ReadPreferenceMode;
  /** The read concern level sent to the driver. */
  readonly readConcern?: ReadConcernLevel;
  /** The write concern sent to the driver. */
  readonly writeConcern?: PlanOptions["writeConcern"];
  /** The index hint. */
  readonly hint?: PlanOptions["hint"];
  /** The collation. */
  readonly collation?: PlanOptions["collation"];
  /** The comment attached to the command. */
  readonly comment?: string;
  /** The cursor batch size. */
  readonly batchSize?: number;
  /** Whether stages may spill to disk. */
  readonly allowDiskUse?: boolean;
}

/**
 * Everything the model hands to a new context.
 *
 * @example
 * ```ts
 * const ctx = new OperationContext({ plan, mode: "sync", target, environment });
 * ```
 */
export interface OperationContextInit<P extends ExecutionPlan = ExecutionPlan> {
  /** The frozen plan of the operation. */
  readonly plan: P;
  /** How the operation is executed. */
  readonly mode: ExecutionMode;
  /** What the operation works on. */
  readonly target: OperationTarget;
  /** The connection-side services. */
  readonly environment: OperationEnvironment;
  /** The enclosing operation (populate sub-queries), for nested instrumentation events. */
  readonly parent?: OperationContext;
  /** A write of a document method (see {@link OperationContext.document}). */
  readonly document?: DocumentWrite;
}

/**
 * A document write's own preparation (`save`: the cast of assigned values and the validation with the
 * `document.validate` hooks). The pipeline runs it inside the operation, before every step, and fills the
 * operation's values from it; its failure is the operation's failure (`operation.error`, `wrap`).
 *
 * @param ctx - The context of the operation being prepared.
 * @returns A promise settled when the values are filled.
 * @throws {TypemoError} When the cast or the validation of the document fails.
 *
 * @example
 * ```ts
 * const prepare: DocumentPrepare = async (ctx) => {
 *   ctx.documents = [await castAndValidate(doc)];
 * };
 * ```
 */
export type DocumentPrepare = (ctx: OperationContext) => Promise<void>;

/**
 * The hooks of the operations inside a `bulkWrite` (each runs the hooks of its standalone counterpart); the
 * `hooksPre` step runs their pre hooks. Implemented by `BulkUnits`.
 *
 * @example
 * ```ts
 * const units: BulkOperationHooks = { pre: (ctx) => undefined };
 * ```
 */
export interface BulkOperationHooks {
  /**
   * Runs the pre hooks of the bulk's operations, in order (after the value steps, before `model.bulkWrite` pre).
   *
   * @param ctx - The context of the bulkWrite.
   * @returns A promise when a hook runs, `undefined` otherwise.
   */
  pre(ctx: OperationContext): Promise<void> | undefined;
}

/**
 * A write a document method issues — {@link OperationContext.document}.
 *
 * @example
 * ```ts
 * const write: DocumentWrite = { kind: "values", prepare: async (ctx) => {} };
 * ```
 */
export interface DocumentWrite {
  /**
   * - `"values"` (`save`, `bulkSave`, `$deleteOne`): the values are the document's, already cast and validated by the
   *   document layer, so `cast` does not cast them again (a user `set` runs once, Mongoose H508) and `validate`
   *   does not run the validators again;
   * - `"hooks"` (`$updateOne`): the pipeline casts and validates the values as usual.
   *
   * Either way the document runs its own `document.*` hooks, so no query or model hook fires (unless `model`).
   */
  readonly kind: "values" | "hooks";
  /**
   * The document's preparation, run inside the operation before every step; its failure fails it at `validate`
   * (or at the step named by `stage`).
   */
  readonly prepare?: DocumentPrepare;
  /**
   * A model method that writes through documents (`insertMany`): besides the `document.*` hooks of every document,
   * the operation keeps its own model event, and the audit records it as the model's write.
   */
  readonly model?: true;
  /** Where the preparation is: the step a failure of `prepare` is reported at (`validate` when absent). */
  readonly stage?: { step: StepName };
  /**
   * Called for every inserted record with its input index: commits the document the record was built from and gives
   * it back as the operation's result (without it the sent record is the result).
   */
  readonly inserted?: (index: number, stored: Readonly<Record<string, unknown>>) => unknown;
  /**
   * The operations (`bulkWrite` indexes) whose values the document layer prepared — inserts of hydrated documents,
   * cast and validated by the document with its hooks: `cast` and `validate` leave them alone (kind `"hooks"`
   * still casts and validates the others).
   */
  readonly prepared?: ReadonlySet<number>;
  /** The hooks of the operations inside a `bulkWrite` (see {@link BulkOperationHooks}). */
  readonly units?: BulkOperationHooks;
}

/**
 * The control fields a value step writes; the snapshot puts them back together with the working values.
 *
 * @example
 * ```ts
 * const flags: DerivedFlags = { softDelete: false };
 * ```
 */
export interface DerivedFlags {
  readonly softDelete: boolean;
}

/**
 * The context of ONE operation: created by the model, handed to every step of the `OperationPipeline` in order, and
 * visible to hooks, policies and instrumentation. `P` is the plan kind; steps usually take `OperationContext` and
 * branch on `ctx.op`.
 *
 * It has two halves. The input (`plan`, `op`, `mode`, `target`) is immutable; the plan is frozen user data. The
 * working values (`filter`, `update`, `documents`, ...) are replaced by the steps, never mutated in place because
 * the initial values are the frozen plan values, and `execute` sends whatever they hold at that point.
 *
 * Contract for steps:
 * - after `normalize`, `resolvePaths` and `cast` the working values hold cast BSON values under code names, and
 *   the policies work in code names too; `EncodeStep` (the end of `validate`) renames them to database names
 *   (`dbName` aliases, Mongoose H14), and that is what `execute` sends;
 * - a step never calls the driver; only `execute` does (`DriverExecutor`);
 * - a step that rejects throws a `TypemoError` subclass; for an unordered `insertMany`/`bulkWrite` a per-document
 *   failure is `ctx.reject(index, error)` instead, and the other documents still go.
 *
 * Three kinds of state:
 * - typed control state (`document`, `skipped`, `softDelete`, `instrumentStarted`, `heldSteps`) is what changes how
 *   the pipeline runs; it is a typed field, never a `locals` entry;
 * - the snapshot (a pre hook's `modify`) puts back the working values, `softDelete` and `locals`; the other control
 *   fields are not rolled back, so the held step events, the skip and the document write outlive a change;
 * - `locals` is scratch of steps only: data a step derives for a later step, keyed by a symbol the step owns.
 *   Nothing in it steers the pipeline.
 *
 * @example
 * ```ts
 * const ctx = new OperationContext({ plan, mode: "sync", target, environment });
 * ctx.filter = { ...ctx.filter, deletedAt: null };
 * ```
 */
export class OperationContext<P extends ExecutionPlan = ExecutionPlan> {
  /** A process-unique id (instrumentation links nested events by it). */
  readonly id: number;
  /** The enclosing operation (populate sub-queries), `undefined` for a top-level one. */
  readonly parent: OperationContext | undefined;
  /** The frozen plan of the operation. */
  readonly plan: P;
  /** The operation name. */
  readonly op: P["op"];
  /** How the operation is executed. */
  readonly mode: ExecutionMode;
  /** What the operation works on. */
  readonly target: OperationTarget;
  /** The connection-side services. */
  readonly environment: OperationEnvironment;
  /** `performance.now()` at creation. */
  readonly startedAt: number;
  /** A write of a document method, `undefined` for a model/query operation. Fixed at creation. */
  readonly document: DocumentWrite | undefined;

  /* Resolved by the first step (`resolveContext`). */
  /** The session: explicit (`.session(s)`) or the ambient transaction's (ALS). */
  session: ClientSession | undefined = undefined;
  /** Client-side operation timeout (CSOT): the plan's, else the connection's default. */
  timeoutMS: number | undefined = undefined;
  /** The options that go to the driver (besides session/timeout), after `validateOptions`. */
  options: ResolvedOptions = {};
  /**
   * The policy context (tenant, actor, soft delete view): the plan's (the ambient scope when it was built plus
   * `.policy()`), else the parent operation's (populate), else the ambient one at run time.
   */
  policy: Readonly<PolicyValues> = PolicyContext.EMPTY;

  /* Working values: replaced by steps, initially the frozen plan values. */
  /** The filter. */
  filter: PlanDocument | undefined;
  /** The update document or update pipeline. */
  update: PlanDocument | readonly PlanDocument[] | undefined;
  /** The replacement document. */
  replacement: PlanDocument | undefined;
  /** The documents of an insert. */
  documents: readonly PlanDocument[] | undefined;
  /** The models of a `bulkWrite`. */
  operations: readonly BulkWriteModel[] | undefined;
  /** The stages of an aggregation. */
  pipeline: readonly PipelineStage[] | undefined;
  /** The projection. */
  projection: PlanDocument | undefined;
  /** The sort pairs. */
  sort: readonly SortPair[] | undefined;
  /** The `arrayFilters` of an update. */
  arrayFilters: readonly PlanDocument[] | undefined;

  /* Outcome. */
  /** The raw driver result after `execute`, the typed result after `postProcess`. */
  result: unknown = undefined;
  /** The error when a step failed (a `TypemoError` after classification). */
  error: unknown = undefined;
  /** The step that failed. */
  failedStep: StepName | undefined = undefined;
  /** Documents the server reported (or the steps counted) for instrumentation. */
  documentCount: number | undefined = undefined;
  /**
   * A cursor batch went through every step after `execute`, so its `post` hooks ran. A later failure of the cursor
   * (`getMore`, a step of a later batch) then runs no `postError`: the error goes to the caller as it is.
   */
  postDone = false;

  /**
   * The pipeline running this operation (set when it starts): a pre hook that changed the operation has its value
   * steps run again by it.
   */
  runner: OperationPipeline | undefined = undefined;

  /**
   * @internal The `this` object of the operation's hooks (`OperationHooks`, created by the first hook that runs). Not
   * in
   * `locals`: a pre hook's change puts the locals back as they were before the value steps, and the hooks
   * object — with the hooks' own `locals` and the change so far — must outlive that.
   */
  hooks: object | undefined = undefined;

  /* Typed control state (see the class comment): never in `locals`. */
  /**
   * A pre hook skipped the operation (`this.skip(result)`): `execute` does not call the driver, nothing is
   * audited, and the result is the one the hook gave. Not rolled back by a hook's change.
   */
  skipped: { readonly result: unknown } | undefined = undefined;
  /**
   * The soft-delete policy turned a `deleteOne`/`deleteMany`/`findOneAndDelete` into the soft-delete update (the
   * executor sends the update). Written by a value step (`policies`), so the snapshot puts it back.
   */
  softDelete = false;
  /** `operation.start` is out; step events are emitted directly from now on. */
  instrumentStarted = false;
  /**
   * The `operation.step` events of steps before `instrumentStart`, held until `operation.start`. Not rolled back
   * by a hook's change: the value steps that run again emit no events, so the first run's are the only ones.
   */
  heldSteps: StepEvent[] | undefined = undefined;

  /** Scratch space of steps, keyed by a symbol the step owns: data for a later step only, never control state. */
  readonly locals = new Map<symbol, unknown>();

  readonly #rejected = new Map<number, TypemoError>();
  /* How many `locals` / rejected entries existed when the value steps started (`-1`: not started). */
  #localsBefore = -1;
  #rejectedBefore = -1;
  #flagsBefore: DerivedFlags = { softDelete: false };

  /** The working values the value steps rewrite. */
  static readonly VALUE_FIELDS: readonly ValueField[] = VALUE_FIELDS;

  /**
   * @param init - The plan, mode, target and environment; the working values start as the plan's values.
   */
  constructor(init: OperationContextInit<P>) {
    this.id = ++NEXT_OPERATION_ID;
    this.parent = init.parent;
    this.plan = init.plan;
    this.op = init.plan.op;
    this.mode = init.mode;
    this.target = init.target;
    this.environment = init.environment;
    this.startedAt = performance.now();
    this.document = init.document;
    const plan = init.plan as unknown as Partial<Record<string, unknown>>;
    this.filter = plan.filter as PlanDocument | undefined;
    this.update = plan.update as PlanDocument | readonly PlanDocument[] | undefined;
    this.replacement = plan.replacement as PlanDocument | undefined;
    this.documents = plan.documents as readonly PlanDocument[] | undefined;
    this.operations = plan.operations as readonly BulkWriteModel[] | undefined;
    this.pipeline = plan.pipeline as readonly PipelineStage[] | undefined;
    this.projection = plan.projection as PlanDocument | undefined;
    this.sort = plan.sort as readonly SortPair[] | undefined;
    this.arrayFilters = plan.arrayFilters as readonly PlanDocument[] | undefined;
  }

  /**
   * The operation name (`find`, `insertMany`, ...).
   *
   * @returns The name of the operation.
   */
  get name(): OperationName {
    return this.op;
  }

  /**
   * Tells whether the operation is a document write whose values the document layer cast and validated.
   *
   * @returns `true` when `DocumentWrite.kind` is `"values"`.
   */
  get isDocument(): boolean {
    return this.document?.kind === "values";
  }

  /**
   * The hook event of this operation.
   *
   * @returns The event, or `undefined` when it has none: a change stream, and every write a document issues
   * (`$save`, `create`, `insertOne`, `bulkSave`, `$updateOne`, `$deleteOne`) — those run the `document.*` hooks of
   * the document instead. `insertMany` has both: its model event, and `document.save` of every document.
   */
  get hookEvent(): Exclude<HookEvent, `document.${string}`> | undefined {
    if (this.document !== undefined && this.document.model !== true) return undefined;
    switch (this.op) {
      case "insertOne":
      case "watch":
        return undefined;
      case "insertMany":
        return "model.insertMany";
      case "bulkWrite":
        return "model.bulkWrite";
      case "aggregate":
        return "aggregate";
      default:
        return `query.${this.op}` as QueryHookEvent;
    }
  }

  /**
   * Tells whether the session's transaction is active.
   *
   * @returns `true` inside a transaction.
   */
  get inTransaction(): boolean {
    return this.session?.inTransaction() === true;
  }

  /**
   * Leaves out one document of an unordered `insertMany`/`bulkWrite` (`index` in the user's input):
   * it is not sent, and the error is reported in the `BulkWriteError` with the server's write errors.
   *
   * @param index - The index of the document in the user's input.
   * @param error - Why the document was rejected.
   */
  reject(index: number, error: TypemoError): void {
    this.#rejected.set(index, error);
  }

  /**
   * The documents left out so far, by input index.
   *
   * @returns The rejected documents sorted by index.
   */
  get rejected(): readonly RejectedDocument[] {
    return [...this.#rejected].map(([index, error]) => ({ index, error })).sort((a, b) => a.index - b.index);
  }

  /**
   * Tells whether an input document was rejected.
   *
   * @param index - The index in the user's input.
   * @returns `true` when the document at `index` was rejected.
   */
  isRejected(index: number): boolean {
    return this.#rejected.has(index);
  }

  /**
   * @internal Called by the pipeline right before the first value step. Two counts, no copy: `locals` and the rejected
   * documents are insertion-ordered maps, so what existed before the value steps is their first entries — a value
   * step only ADDS its own keys (it never deletes or rewrites an older entry; checked by
   * `test/runtime/mechanisms/hook-modify.test.ts`).
   */
  beginValues(): void {
    this.#flagsBefore = { softDelete: this.softDelete };
    this.#localsBefore = this.locals.size;
    this.#rejectedBefore = this.#rejected.size;
  }

  /**
   * @internal The state before the value steps (see {@link ValuesSnapshot}). Taken only when a pre hook changed the
   * operation.
   *
   * @returns The snapshot.
   * @throws {TypemoError} When the value steps have not started.
   */
  snapshotValues(): ValuesSnapshot {
    if (this.#localsBefore < 0) {
      throw new TypemoError("Internal error: the value steps of this operation have not started");
    }
    const plan = this.plan as unknown as Partial<Record<string, unknown>>;
    const values = {} as Record<ValueField, unknown>;
    for (const field of VALUE_FIELDS) values[field] = plan[field];
    return {
      values,
      locals: [...this.locals].slice(0, this.#localsBefore),
      rejected: [...this.#rejected].slice(0, this.#rejectedBefore),
      flags: this.#flagsBefore,
    };
  }

  /**
   * @internal Puts the whole snapshot back (every working value, `locals` and the rejected documents as they were
   * before the value steps) so the steps can run again; whatever they derived before is gone, whoever wrote it.
   *
   * @param snapshot - The snapshot taken by `snapshotValues`.
   */
  restoreValues(snapshot: ValuesSnapshot): void {
    const self = this as unknown as Record<ValueField, unknown>;
    for (const field of VALUE_FIELDS) self[field] = snapshot.values[field];
    this.locals.clear();
    for (const [key, value] of snapshot.locals) this.locals.set(key, value);
    this.#rejected.clear();
    for (const [index, error] of snapshot.rejected) this.#rejected.set(index, error);
    this.softDelete = snapshot.flags.softDelete;
  }
}
