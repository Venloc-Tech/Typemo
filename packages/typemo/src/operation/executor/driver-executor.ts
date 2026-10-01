import type {
  AnyBulkWriteOperation,
  ChangeStream,
  Collection,
  CreateCollectionOptions,
  Document,
  AggregateOptions as DriverAggregateOptions,
  BulkWriteResult as DriverBulkWriteResult,
  Filter,
  FindOptions,
  IndexDescription,
  IndexDescriptionInfo,
  Sort,
  UpdateFilter,
} from "mongodb";
import { CollectionGuard } from "../../collections/collection-guard.ts";
import { type SessionAccess, SessionGuard } from "../../connection/session-guard.ts";
import { BulkWriteError, type BulkWriteFailure, type BulkWriteSummary } from "../../errors/bulk-write-error.ts";
import { ErrorTranslator } from "../../errors/error-translator.ts";
import { StrictModeError } from "../../errors/strict-mode-error.ts";
import { TimeoutError } from "../../errors/timeout-error.ts";
import type { TypemoError } from "../../errors/typemo-error.ts";
import { OperationLink, OperationScope } from "../../instrumentation/operation-scope.ts";
import type { FindPlan, ModifyPlan, ValuePlan, WritePlan } from "../../query/plan.ts";
import type {
  AggregateExecutionPlan,
  BulkWriteModel,
  BulkWritePlan,
  InsertPlan,
  WatchPlan,
} from "../pipeline/execution-plan.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import { EncodeStep } from "../steps/encode-step.ts";
import { OperationView } from "../steps/operation-view.ts";
import { ReplacementGuard, type ReplacementGuardState } from "../steps/replacement-guard.ts";
import { ReplacementPipeline } from "../steps/replacement-pipeline.ts";
import { type UpdateGuard, UpdateGuards } from "../steps/update-guards.ts";

/*
 * The ONLY place that calls the driver. It sends what the context holds after the steps
 * before it (database form: names, cast values), passes `timeoutMS` through (CSOT), marks the session
 * busy while the command is in flight, links driver command events to the operation
 * and turns driver errors into the Typemo hierarchy (the driver error is the `cause`).
 * Results stay the driver's here; `postProcess` normalizes them.
 */

/**
 * A driver document.
 *
 * @example
 * const doc: Doc = { _id: 1, name: "a" };
 */
type Doc = Document;

/**
 * The raw result of `insertOne`/`insertMany`: what was sent, by input index.
 *
 * @example
 * const outcome: InsertOutcome = { inserted: new Map([[0, { _id: 1 }]]) };
 */
export interface InsertOutcome {
  /** The documents that were inserted, by input index (the `_id` the driver used included). */
  readonly inserted: ReadonlyMap<number, Doc>;
}

/**
 * Everything `execute` can leave in `ctx.result`.
 *
 * @example
 * const raw: RawResult = await DriverExecutor.execute(ctx);
 */
export type RawResult = unknown;

/**
 * The options without `undefined` values (`exactOptionalPropertyTypes`: absent, never `undefined`).
 *
 * @typeParam T - The options type.
 * @example
 * type A = Defined<{ a: number | undefined }>; // { a?: number }
 */
type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Drops the `undefined` entries of an options object.
 *
 * @param value - The options.
 * @returns A new object without the `undefined` entries.
 */
const defined = <T extends object>(value: T): Defined<T> =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Defined<T>;

/**
 * Calls into the driver.
 *
 * @example
 * const raw = await DriverExecutor.execute(ctx); // the driver's result of the operation the context holds
 */
export class DriverExecutor {
  /**
   * The operation's command link (one per operation: a retried call keeps reporting into it).
   *
   * @param ctx - The operation context.
   * @returns The link, created on first use.
   */
  private static link(ctx: OperationContext): OperationLink {
    let link = ctx.locals.get(OperationScope.LINK);
    if (!(link instanceof OperationLink)) {
      link = new OperationLink(ctx.id, ctx.target.schema);
      ctx.locals.set(OperationScope.LINK, link);
    }
    return link as OperationLink;
  }

  /**
   * Runs the operation of `ctx` and returns the driver's raw result (a cursor in cursor mode).
   *
   * @param ctx - The operation context.
   * @returns The driver's raw result.
   * @throws {TypemoError} The driver's error, classified into the Typemo hierarchy (the driver error is the `cause`).
   */
  static async execute(ctx: OperationContext): Promise<RawResult> {
    /* A write that would create the collection without the schema's creation-only options, or the first
       operation of a typed view that may not exist (see CollectionGuard). */
    const found = CollectionGuard.beforeWrite(ctx) ?? CollectionGuard.beforeView(ctx);
    if (found !== undefined) await found;
    const call = (): Promise<RawResult> => DriverExecutor.dispatch(ctx);
    const linked = ctx.environment.linksDriverCommands()
      ? () => OperationScope.run(DriverExecutor.link(ctx), call)
      : call;
    /*
     * A cursor holds no lock between batches (a getMore interleaved with other operations is fine);
     * the cursor source guards each batch fetch itself.
     */
    const guarded =
      ctx.mode === "cursor" || ctx.op === "watch"
        ? linked
        : () => SessionGuard.around(ctx.session, OperationView.where(ctx), linked, DriverExecutor.access(ctx));
    try {
      return await guarded();
    } catch (error) {
      throw TimeoutError.withLimit(ErrorTranslator.wrap(error), "operation", ctx.timeoutMS);
    }
  }

  /**
   * Whether the operation only reads (reads may overlap on a session outside a transaction).
   *
   * @param ctx - The operation context.
   * @returns `"read"` for reads and aggregations without `$out`/`$merge`, `"write"` otherwise.
   */
  static access(ctx: OperationContext): SessionAccess {
    switch (ctx.op) {
      case "find":
      case "findOne":
      case "countDocuments":
      case "estimatedDocumentCount":
      case "distinct":
        return "read";
      case "aggregate": {
        const last = ctx.pipeline?.at(-1);
        return last !== undefined && ("$out" in last || "$merge" in last) ? "write" : "read";
      }
      default:
        return "write";
    }
  }

  /**
   * The driver collection of the operation's model.
   *
   * @param ctx - The operation context.
   * @returns The collection.
   */
  static collection(ctx: OperationContext): Collection<Doc> {
    return ctx.environment.driver.db.collection<Doc>(ctx.target.collection);
  }

  /**
   * Sends the plan to the method of its operation kind.
   *
   * @param ctx - The operation context.
   * @returns The driver's raw result.
   */
  private static async dispatch(ctx: OperationContext): Promise<RawResult> {
    switch (ctx.plan.op) {
      case "find":
      case "findOne":
        return DriverExecutor.find(ctx as OperationContext<FindPlan>);
      case "countDocuments":
      case "estimatedDocumentCount":
      case "distinct":
        return DriverExecutor.value(ctx as OperationContext<ValuePlan>);
      case "updateOne":
      case "updateMany":
      case "replaceOne":
      case "deleteOne":
      case "deleteMany":
        return DriverExecutor.write(ctx as OperationContext<WritePlan>);
      case "findOneAndUpdate":
      case "findOneAndReplace":
      case "findOneAndDelete":
        return DriverExecutor.modify(ctx as OperationContext<ModifyPlan>);
      case "insertOne":
      case "insertMany":
        return DriverExecutor.insert(ctx as OperationContext<InsertPlan>);
      case "bulkWrite":
        return DriverExecutor.bulkWrite(ctx as OperationContext<BulkWritePlan>);
      case "aggregate":
        return DriverExecutor.aggregate(ctx as OperationContext<AggregateExecutionPlan>);
      case "watch":
        return DriverExecutor.watch(ctx as OperationContext<WatchPlan>);
    }
  }

  /**
   * Options every command takes.
   *
   * @param ctx - The operation context.
   * @returns The session, the timeout and the comment.
   */
  private static common(ctx: OperationContext) {
    return defined({
      session: ctx.session,
      timeoutMS: ctx.timeoutMS,
      comment: ctx.options.comment,
    });
  }

  /**
   * Read preference and read concern of a read. The read concern is the operation's, else the schema's
   * `readConcern` — except inside a transaction, where the transaction's own read concern applies.
   *
   * @param ctx - The operation context.
   * @returns The options that are set.
   */
  private static readOptions(ctx: OperationContext) {
    const level = ctx.options.readConcern;
    const readConcern =
      level !== undefined ? { level } : ctx.inTransaction ? undefined : ctx.target.schema.options.readConcern;
    return defined({ readPreference: ctx.options.readPreference, readConcern });
  }

  /**
   * The write concern of a write: the operation's, else the schema's `writeConcern` — except inside a
   * transaction, where the driver refuses a per-operation write concern (the transaction's applies).
   *
   * @param ctx - The operation context.
   * @returns `{ writeConcern }` when set, else an empty object.
   */
  private static writeConcern(ctx: OperationContext) {
    const concern = ctx.options.writeConcern;
    if (concern !== undefined) return { writeConcern: defined({ w: concern.w, journal: concern.journal }) };
    const schema = ctx.inTransaction ? undefined : ctx.target.schema.options.writeConcern;
    return schema === undefined ? {} : { writeConcern: schema };
  }

  /**
   * The sort as the driver takes it: a list of `[path, direction]` pairs.
   *
   * @param ctx - The operation context.
   * @returns The sort, or `undefined` when none.
   */
  private static sort(ctx: OperationContext): Sort | undefined {
    return ctx.sort === undefined
      ? undefined
      : (ctx.sort.map(([path, direction]) => [path, direction]) as unknown as Sort);
  }

  /**
   * The driver options of a find.
   *
   * @param ctx - The operation context.
   * @returns The options that are set.
   */
  private static findOptions(ctx: OperationContext<FindPlan>): FindOptions {
    return defined({
      ...DriverExecutor.common(ctx),
      ...DriverExecutor.readOptions(ctx),
      projection: ctx.projection as Doc | undefined,
      sort: DriverExecutor.sort(ctx),
      skip: ctx.plan.skip,
      limit: ctx.plan.limit,
      hint: ctx.options.hint as Doc | string | undefined,
      collation: ctx.options.collation,
      batchSize: ctx.options.batchSize,
      allowDiskUse: ctx.options.allowDiskUse,
    }) as FindOptions;
  }

  /**
   * `find` / `findOne`: explained, streamed as a cursor, or read to completion.
   *
   * @param ctx - The operation context.
   * @returns The explain result, the cursor, the document (or `null`), or the documents.
   */
  private static async find(ctx: OperationContext<FindPlan>): Promise<RawResult> {
    const collection = DriverExecutor.collection(ctx);
    const filter = (ctx.filter ?? {}) as Filter<Doc>;
    const options = DriverExecutor.findOptions(ctx);
    const mode = ctx.plan.mode;
    if (mode.kind === "explain") {
      return collection.find(filter, ctx.op === "findOne" ? { ...options, limit: 1 } : options).explain(mode.verbosity);
    }
    if (ctx.mode === "cursor") return collection.find(filter, options);
    if (ctx.op === "findOne") return collection.findOne(filter, options);
    return collection.find(filter, options).toArray();
  }

  /**
   * `countDocuments` / `estimatedDocumentCount` / `distinct`.
   *
   * @param ctx - The operation context.
   * @returns The count or the distinct values.
   */
  private static async value(ctx: OperationContext<ValuePlan>): Promise<RawResult> {
    const collection = DriverExecutor.collection(ctx);
    const filter = (ctx.filter ?? {}) as Filter<Doc>;
    const common = { ...DriverExecutor.common(ctx), ...DriverExecutor.readOptions(ctx) };
    if (ctx.op === "estimatedDocumentCount") return collection.estimatedDocumentCount(common);
    if (ctx.op === "countDocuments") {
      return collection.countDocuments(
        filter,
        defined({
          ...common,
          skip: ctx.plan.skip,
          limit: ctx.plan.limit,
          hint: ctx.options.hint as Doc | string | undefined,
          collation: ctx.options.collation,
        }),
      );
    }
    /* The database path of the field (dbName, Mongoose H14), translated by the encode step. */
    const field = ctx.locals.get(EncodeStep.DISTINCT_FIELD);
    const key = typeof field === "string" ? field : (ctx.plan.field ?? "");
    return collection.distinct(key, filter, defined({ ...common, collation: ctx.options.collation }));
  }

  /**
   * `updateOne` / `updateMany` / `replaceOne` / `deleteOne` / `deleteMany`. A guarded update that matched
   * nothing is followed by a read that tells a failed guard from a missing document; a soft delete is an update.
   *
   * @param ctx - The operation context.
   * @returns The driver's write result (a soft delete gives a delete-shaped result).
   * @throws {ValidationError} When a `$inc`/`$mul` guard failed.
   */
  private static async write(ctx: OperationContext<WritePlan>): Promise<RawResult> {
    const collection = DriverExecutor.collection(ctx);
    const filter = (ctx.filter ?? {}) as Filter<Doc>;
    const options = defined({
      ...DriverExecutor.common(ctx),
      ...DriverExecutor.writeConcern(ctx),
      hint: ctx.options.hint as Doc | string | undefined,
      collation: ctx.options.collation,
    });
    const update = defined({
      ...options,
      upsert: ctx.plan.upsert,
      arrayFilters: ctx.arrayFilters as Doc[] | undefined,
    });
    const guard = UpdateGuards.of(ctx);
    switch (ctx.op) {
      case "updateOne": {
        const result = await collection.updateOne(filter, ctx.update as UpdateFilter<Doc> | Doc[], update);
        if (guard !== undefined && result.matchedCount === 0) await DriverExecutor.guardFailed(ctx, guard);
        return result;
      }
      case "updateMany": {
        /* One document at most (`_id` equality) — like updateOne: no pre-check, a read only on no match. */
        const single = guard?.single === true;
        if (guard !== undefined && !single) {
          const outside = await collection.findOne(guard.outOfRange as Filter<Doc>, {
            ...DriverExecutor.common(ctx),
            projection: guard.projection,
          });
          if (outside !== null) throw guard.failure(outside);
        }
        const result = await collection.updateMany(filter, ctx.update as UpdateFilter<Doc> | Doc[], update);
        if (guard !== undefined && single && result.matchedCount === 0) await DriverExecutor.guardFailed(ctx, guard);
        return result;
      }
      case "replaceOne": {
        /* Immutable fields must agree with the stored document (see ReplacementGuard). */
        const replaced = ReplacementGuard.of(ctx, 0);
        if (replaced?.upsert === true) await DriverExecutor.replacementRefused(ctx, replaced, "before");
        /* Service fields are kept by an update pipeline (see ReplacementPipeline). */
        const result = ReplacementPipeline.needed(ctx.target.schema)
          ? await collection.updateOne(
              filter,
              DriverExecutor.replacementPipeline(ctx),
              defined({ ...options, upsert: ctx.plan.upsert }),
            )
          : await collection.replaceOne(
              filter,
              { ...(ctx.replacement as Doc) },
              defined({ ...options, upsert: ctx.plan.upsert }),
            );
        if (replaced !== undefined && !replaced.upsert && result.matchedCount === 0) {
          await DriverExecutor.replacementRefused(ctx, replaced, "after");
        }
        return result;
      }
      case "deleteOne":
      case "deleteMany": {
        if (ctx.softDelete) {
          /* Soft delete: the update of the delete date; the result keeps the delete's form. */
          const soft = ctx.update as UpdateFilter<Doc>;
          const result =
            ctx.op === "deleteOne"
              ? await collection.updateOne(filter, soft, options)
              : await collection.updateMany(filter, soft, options);
          return { acknowledged: result.acknowledged, deletedCount: result.modifiedCount };
        }
        return ctx.op === "deleteOne" ? collection.deleteOne(filter, options) : collection.deleteMany(filter, options);
      }
      default:
        return collection.deleteMany(filter, options);
    }
  }

  /**
   * `findOneAndUpdate` / `findOneAndReplace` / `findOneAndDelete`, always with the result metadata.
   *
   * @param ctx - The operation context.
   * @returns The driver's `ModifyResult`.
   * @throws {ValidationError} When a `$inc`/`$mul` guard failed.
   */
  private static async modify(ctx: OperationContext<ModifyPlan>): Promise<RawResult> {
    const collection = DriverExecutor.collection(ctx);
    const filter = (ctx.filter ?? {}) as Filter<Doc>;
    /* Always with metadata: `postProcess` needs `lastErrorObject` (upsert) and returns `value` unless asked. */
    const options = defined({
      ...DriverExecutor.common(ctx),
      ...DriverExecutor.writeConcern(ctx),
      projection: ctx.projection as Doc | undefined,
      sort: DriverExecutor.sort(ctx),
      /* The driver types the hint as a document; the server takes a name too. */
      hint: ctx.options.hint as Doc | undefined,
      collation: ctx.options.collation,
      includeResultMetadata: true as const,
    });
    if (ctx.op === "findOneAndDelete") {
      /* Soft delete: the update of the delete date, returning the document as it was (like a delete). */
      if (ctx.softDelete) {
        return collection.findOneAndUpdate(filter, ctx.update as UpdateFilter<Doc>, {
          ...options,
          returnDocument: "before",
        });
      }
      return collection.findOneAndDelete(filter, options);
    }
    const upsert = { upsert: ctx.plan.upsert, returnDocument: ctx.plan.returnDocument };
    if (ctx.op === "findOneAndReplace") {
      /* Immutable fields must agree with the stored document (see ReplacementGuard). */
      const replaced = ReplacementGuard.of(ctx, 0);
      if (replaced?.upsert === true) await DriverExecutor.replacementRefused(ctx, replaced, "before");
      const replacedResult = ReplacementPipeline.needed(ctx.target.schema)
        ? await collection.findOneAndUpdate(filter, DriverExecutor.replacementPipeline(ctx), { ...options, ...upsert })
        : await collection.findOneAndReplace(filter, { ...(ctx.replacement as Doc) }, { ...options, ...upsert });
      if (replaced !== undefined && !replaced.upsert && (replacedResult === null || replacedResult.value === null)) {
        await DriverExecutor.replacementRefused(ctx, replaced, "after");
      }
      return replacedResult;
    }
    const result = await collection.findOneAndUpdate(
      filter,
      ctx.update as UpdateFilter<Doc> | Doc[],
      defined({ ...options, ...upsert, arrayFilters: ctx.arrayFilters as Doc[] | undefined }),
    );
    const guard = UpdateGuards.of(ctx);
    if (guard !== undefined && (result === null || result.value === null)) await DriverExecutor.guardFailed(ctx, guard);
    return result;
  }

  /**
   * The replacement of the context as an update pipeline keeping the service fields.
   *
   * @param ctx - The operation context.
   * @returns The pipeline stages.
   */
  private static replacementPipeline(ctx: OperationContext): Doc[] {
    return ReplacementPipeline.of(ctx.target.schema, ctx.replacement ?? {}, OperationView.now(ctx)) as unknown as Doc[];
  }

  /**
   * A guarded update matched nothing — the follow-up read (same session) tells a failed guard
   * (a document matches the user's filter: `ValidationError`) from a missing document (returns).
   *
   * @param ctx - The operation context.
   * @param guard - The guard state.
   * @throws {ValidationError} When a document matches the user's filter, so the guard failed.
   */
  private static async guardFailed(ctx: OperationContext, guard: UpdateGuard): Promise<void> {
    const stored = await DriverExecutor.collection(ctx).findOne(
      guard.filter as Filter<Doc>,
      defined({
        ...DriverExecutor.common(ctx),
        projection: guard.projection,
        sort: DriverExecutor.sort(ctx),
      }),
    );
    if (stored !== null) throw guard.failure(stored);
  }

  /**
   * The check read of a guarded replacement (see `ReplacementGuard`): `before` an upsert or a `bulkWrite`, it
   * looks for a document of the user's filter the guard refuses; `after` a replacement that matched nothing, for any
   * document of the user's filter (then the guard, not the filter, refused it). Same session as the write.
   *
   * @param ctx - The operation context.
   * @param state - The guard state of the replacement.
   * @param when - Whether the read precedes the write or follows a write that matched nothing.
   * @throws {StrictModeError} With rule `immutable` when a document of the filter disagrees on an immutable field.
   */
  private static async replacementRefused(
    ctx: OperationContext,
    state: ReplacementGuardState,
    when: "before" | "after",
  ): Promise<void> {
    const row = await DriverExecutor.collection(ctx).findOne(
      (when === "before" ? ReplacementGuard.refused(state) : state.filter) as Filter<Doc>,
      defined({
        ...DriverExecutor.common(ctx),
        projection: ReplacementGuard.projection(state),
        sort: DriverExecutor.sort(ctx),
      }),
    );
    if (row !== null) throw ReplacementGuard.failure(state, row);
  }

  /**
   * The check reads of the guarded `replaceOne` operations of a `bulkWrite`, before it is sent: its result has no
   * per-operation match counts. A refused operation is left out of an unordered bulk; an ordered one is not sent.
   *
   * @param ctx - The operation context.
   * @throws {StrictModeError} With rule `immutable` for a refused operation of an ordered bulk.
   */
  private static async bulkReplacements(ctx: OperationContext<BulkWritePlan>): Promise<void> {
    for (const [index, state] of ReplacementGuard.all(ctx)) {
      if (ctx.isRejected(index)) continue;
      try {
        await DriverExecutor.replacementRefused(ctx, state, "before");
      } catch (error) {
        if (ctx.plan.ordered || !(error instanceof StrictModeError)) throw error;
        ctx.reject(index, error);
      }
    }
  }

  /**
   * `insertOne` / `insertMany` of the documents that were not rejected earlier.
   *
   * @param ctx - The operation context.
   * @returns The inserted documents by input index.
   * @throws {BulkWriteError} When some documents failed (rejected earlier or by the server).
   */
  private static async insert(ctx: OperationContext<InsertPlan>): Promise<InsertOutcome> {
    const collection = DriverExecutor.collection(ctx);
    const options = { ...DriverExecutor.common(ctx), ...DriverExecutor.writeConcern(ctx) };
    /*
     * Copies: the driver adds `_id` to a document without one (it mutates its argument), and the
     * context's documents are frozen.
     */
    const all = (ctx.documents ?? []).map((doc) => ({ ...doc }));
    const indexes = all.map((_, index) => index).filter((index) => !ctx.isRejected(index));
    const docs = indexes.map((index) => all[index] as Doc);
    const inserted = new Map<number, Doc>();
    if (ctx.op === "insertOne") {
      const [doc] = docs;
      if (doc !== undefined) {
        await collection.insertOne(doc, options);
        inserted.set(0, doc);
      }
      return { inserted };
    }
    let failures: BulkWriteFailure[] = [];
    let summary: BulkWriteSummary | undefined;
    if (docs.length > 0) {
      try {
        const result = await collection.insertMany(docs, { ...options, ordered: ctx.plan.ordered });
        for (const [position, id] of Object.entries(result.insertedIds)) {
          const index = indexes[Number(position)] as number;
          inserted.set(index, { ...(docs[Number(position)] as Doc), _id: id });
        }
      } catch (error) {
        const bulk = DriverExecutor.bulkFailure(error, indexes, ctx.plan.ordered);
        if (bulk === undefined) throw error;
        failures = bulk.failures;
        summary = bulk.summary;
        for (const [index, id] of Object.entries(bulk.summary.insertedIds)) {
          const position = indexes.indexOf(Number(index));
          inserted.set(Number(index), { ...(docs[position] as Doc), _id: id });
        }
      }
    }
    const rejected = DriverExecutor.rejectedFailures(ctx);
    if (failures.length > 0 || rejected.length > 0) {
      throw new BulkWriteError(
        OperationView.where(ctx),
        [...rejected, ...failures],
        summary ?? DriverExecutor.emptySummary(inserted),
        ctx.plan.ordered,
      );
    }
    return { inserted };
  }

  /**
   * `bulkWrite` of the operations that were not rejected earlier.
   *
   * @param ctx - The operation context.
   * @returns The summary, in input indexes.
   * @throws {BulkWriteError} When some operations failed (rejected earlier or by the server).
   */
  private static async bulkWrite(ctx: OperationContext<BulkWritePlan>): Promise<RawResult> {
    const collection = DriverExecutor.collection(ctx);
    const operations = ctx.operations ?? [];
    await DriverExecutor.bulkReplacements(ctx);
    const indexes = operations.map((_, index) => index).filter((index) => !ctx.isRejected(index));
    const models = indexes.map((index) => DriverExecutor.bulkModel(operations[index] as BulkWriteModel));
    const rejected = DriverExecutor.rejectedFailures(ctx);
    let summary: BulkWriteSummary = DriverExecutor.emptySummary(new Map());
    if (models.length > 0) {
      try {
        const result = await collection.bulkWrite(models, {
          ...DriverExecutor.common(ctx),
          ...DriverExecutor.writeConcern(ctx),
          ordered: ctx.plan.ordered,
        });
        summary = DriverExecutor.summary(result, indexes);
      } catch (error) {
        const bulk = DriverExecutor.bulkFailure(error, indexes, ctx.plan.ordered);
        if (bulk === undefined) throw error;
        throw new BulkWriteError(
          OperationView.where(ctx),
          [...rejected, ...bulk.failures],
          bulk.summary,
          ctx.plan.ordered,
          { cause: error },
        );
      }
    }
    if (rejected.length > 0) {
      throw new BulkWriteError(OperationView.where(ctx), rejected, summary, ctx.plan.ordered);
    }
    return summary;
  }

  /**
   * A `bulkWrite` model as the driver takes it (documents are copied: the driver mutates them).
   *
   * @param model - The model.
   * @returns The driver operation.
   */
  private static bulkModel(model: BulkWriteModel): AnyBulkWriteOperation<Doc> {
    if ("insertOne" in model) return { insertOne: { document: { ...model.insertOne.document } } };
    if ("updateOne" in model) {
      const spec = model.updateOne;
      return {
        updateOne: defined({
          filter: spec.filter as Filter<Doc>,
          update: spec.update as UpdateFilter<Doc> | Doc[],
          upsert: spec.upsert,
          arrayFilters: spec.arrayFilters as Doc[] | undefined,
          hint: spec.hint as Doc | string | undefined,
        }) as { filter: Filter<Doc>; update: UpdateFilter<Doc> | Doc[] },
      };
    }
    if ("updateMany" in model) {
      const spec = model.updateMany;
      return {
        updateMany: defined({
          filter: spec.filter as Filter<Doc>,
          update: spec.update as UpdateFilter<Doc> | Doc[],
          upsert: spec.upsert,
          arrayFilters: spec.arrayFilters as Doc[] | undefined,
          hint: spec.hint as Doc | string | undefined,
        }) as { filter: Filter<Doc>; update: UpdateFilter<Doc> | Doc[] },
      };
    }
    if ("replaceOne" in model) {
      const spec = model.replaceOne;
      return {
        replaceOne: defined({
          filter: spec.filter as Filter<Doc>,
          replacement: { ...spec.replacement },
          upsert: spec.upsert,
          hint: spec.hint as Doc | string | undefined,
        }) as { filter: Filter<Doc>; replacement: Doc },
      };
    }
    if ("deleteOne" in model) {
      return {
        deleteOne: defined({
          filter: model.deleteOne.filter as Filter<Doc>,
          hint: model.deleteOne.hint as Doc | string | undefined,
        }) as { filter: Filter<Doc> },
      };
    }
    return {
      deleteMany: defined({
        filter: model.deleteMany.filter as Filter<Doc>,
        hint: model.deleteMany.hint as Doc | string | undefined,
      }) as { filter: Filter<Doc> },
    };
  }

  /**
   * `aggregate`: explained, streamed as a cursor, or read to completion.
   *
   * @param ctx - The operation context.
   * @returns The explain result, the cursor, or the rows.
   */
  private static async aggregate(ctx: OperationContext<AggregateExecutionPlan>): Promise<RawResult> {
    const plan = ctx.plan.aggregateOptions;
    const options = defined({
      ...DriverExecutor.common(ctx),
      ...DriverExecutor.readOptions(ctx),
      ...DriverExecutor.writeConcern(ctx),
      allowDiskUse: plan.allowDiskUse,
      hint: plan.hint as Doc | string | undefined,
      collation: plan.collation,
      comment: plan.comment ?? ctx.options.comment,
      batchSize: plan.batchSize ?? ctx.options.batchSize,
      bypassDocumentValidation: plan.bypassDocumentValidation,
    }) as DriverAggregateOptions;
    const stages = [...(ctx.pipeline ?? [])] as Doc[];
    const target = ctx.target;
    /* A database-level aggregation runs on its database (`admin`, the connection's) or on
       `config.system.sessions`; a model's on its collection. */
    const cursor =
      target.scope === "database" || target.scope === "admin"
        ? ctx.environment.driver.client.db(target.database).aggregate(stages, options)
        : target.scope === "sessions"
          ? ctx.environment.driver.client.db(target.database).collection(target.collection).aggregate(stages, options)
          : DriverExecutor.collection(ctx).aggregate(stages, options);
    if (ctx.mode === "explain") return cursor.explain(ctx.locals.get(EXPLAIN_VERBOSITY) as never);
    if (ctx.mode === "cursor") return cursor;
    return cursor.toArray();
  }

  /**
   * Opens a change stream on the model's collection.
   *
   * @param ctx - The operation context.
   * @returns The driver's change stream.
   */
  private static async watch(ctx: OperationContext<WatchPlan>): Promise<ChangeStream<Doc>> {
    const collection = DriverExecutor.collection(ctx);
    return collection.watch(
      [...(ctx.pipeline ?? [])] as Doc[],
      defined({ ...ctx.plan.watchOptions, session: ctx.session }),
    );
  }

  /**
   * Writes one audit entry (audit policy) in the operation's session — inside its transaction when
   * it has one — with its timeout.
   *
   * @param ctx - The operation context.
   * @param collection - The audit collection.
   * @param entry - The audit entry.
   * @throws {TypemoError} The driver's error, classified into the Typemo hierarchy.
   */
  static async insertAudit(ctx: OperationContext, collection: string, entry: object): Promise<void> {
    const call = async (): Promise<void> => {
      await ctx.environment.driver.db.collection<Doc>(collection).insertOne({ ...entry }, DriverExecutor.common(ctx));
    };
    try {
      await SessionGuard.around(ctx.session, `${OperationView.where(ctx)} (audit)`, call, "write");
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
  }

  /* ---- bulk errors ---- */

  /**
   * The failures of the units rejected before anything was sent.
   *
   * @param ctx - The operation context.
   * @returns One failure per rejected unit.
   */
  private static rejectedFailures(ctx: OperationContext): BulkWriteFailure[] {
    return ctx.rejected.map(({ index, error }) => ({ index, code: undefined, message: error.message, error }));
  }

  /**
   * A summary with nothing but the inserted documents.
   *
   * @param inserted - The inserted documents by input index.
   * @returns The summary.
   */
  private static emptySummary(inserted: ReadonlyMap<number, Doc>): BulkWriteSummary {
    return {
      insertedCount: inserted.size,
      matchedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      upsertedCount: 0,
      insertedIds: Object.fromEntries([...inserted].map(([index, doc]) => [index, doc._id])),
      upsertedIds: {},
    };
  }

  /**
   * A driver `BulkWriteResult` in input indexes.
   *
   * @param result - The driver's result.
   * @param indexes - The input index of each operation that was sent, by position.
   * @returns The summary.
   */
  static summary(result: DriverBulkWriteResult, indexes: readonly number[]): BulkWriteSummary {
    return {
      insertedCount: result.insertedCount,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      deletedCount: result.deletedCount,
      upsertedCount: result.upsertedCount,
      insertedIds: DriverExecutor.reindex(result.insertedIds, indexes),
      upsertedIds: DriverExecutor.reindex(result.upsertedIds, indexes),
    };
  }

  /**
   * Maps ids keyed by position among the sent operations to ids keyed by input index.
   *
   * @param ids - The ids by position.
   * @param indexes - The input index of each operation that was sent, by position.
   * @returns The ids by input index.
   */
  private static reindex(ids: Readonly<Record<number, unknown>>, indexes: readonly number[]): Record<number, unknown> {
    return Object.fromEntries(
      Object.entries(ids).map(([position, id]) => [indexes[Number(position)] ?? Number(position), id]),
    );
  }

  /**
   * The failures of a driver `MongoBulkWriteError` in input indexes, each classified with its `code`
   * kept (Mongoose lost it); `undefined` for any other error.
   *
   * @param error - What the driver threw.
   * @param indexes - The input index of each operation that was sent, by position.
   * @param ordered - Whether the bulk stopped at its first failure.
   * @returns The failures and the summary, or `undefined` when `error` is not a bulk write error.
   */
  private static bulkFailure(
    error: unknown,
    indexes: readonly number[],
    ordered: boolean,
  ): { readonly failures: BulkWriteFailure[]; readonly summary: BulkWriteSummary } | undefined {
    if (!ErrorTranslator.isDriverError(error) || error.name !== "MongoBulkWriteError") return undefined;
    const raw = error as unknown as {
      readonly writeErrors?: unknown;
      readonly result?: DriverBulkWriteResult;
    };
    const list = Array.isArray(raw.writeErrors)
      ? raw.writeErrors
      : raw.writeErrors === undefined
        ? []
        : [raw.writeErrors];
    const failures = list.map((item: unknown): BulkWriteFailure => {
      const writeError = item as {
        readonly index: number;
        readonly code?: number;
        readonly errmsg?: string;
        readonly errInfo?: unknown;
        readonly err?: { readonly keyPattern?: unknown; readonly keyValue?: unknown; readonly errInfo?: unknown };
      };
      const message = writeError.errmsg ?? "write failed";
      const keyed = writeError.err ?? {};
      const classified = ErrorTranslator.serverError(
        writeError.code,
        message,
        { code: writeError.code, codeName: undefined, errorLabels: [], cause: item },
        { errInfo: writeError.errInfo ?? keyed.errInfo, keyPattern: keyed.keyPattern, keyValue: keyed.keyValue },
      ) as TypemoError;
      return {
        index: indexes[writeError.index] ?? writeError.index,
        code: writeError.code,
        message,
        error: classified,
      };
    });
    const result = raw.result;
    const summary =
      result === undefined ? DriverExecutor.emptySummary(new Map()) : DriverExecutor.summary(result, indexes);
    /* The driver lists the `_id` of every insert of a batch it sent, the failed one too (and, in a mixed ordered
       bulk, inserts after the failure): only the inserts the server stored are inserted. */
    const failed = new Set(failures.map((failure) => failure.index));
    const first = Math.min(...failed);
    const stored = (index: number): boolean => !failed.has(index) && (!ordered || index < first);
    const insertedIds = Object.fromEntries(
      Object.entries(summary.insertedIds).filter(([index]) => stored(Number(index))),
    );
    return { failures, summary: Object.freeze({ ...summary, insertedIds: Object.freeze(insertedIds) }) };
  }

  /* ---- administration (not pipeline operations: no plan, no hooks) ---- */

  /**
   * `listIndexes` of the model's collection (`[]` when the collection does not exist).
   *
   * @param collection - The driver collection.
   * @returns The index descriptions.
   * @throws {TypemoError} The driver's error, classified into the Typemo hierarchy.
   */
  static async listIndexes(collection: Collection<Doc>): Promise<IndexDescriptionInfo[]> {
    try {
      return await collection.listIndexes().toArray();
    } catch (error) {
      if (ErrorTranslator.codeOf(error) === 26) return [];
      throw ErrorTranslator.wrap(error);
    }
  }

  /**
   * Creates one index; the driver error is wrapped.
   *
   * @param collection - The driver collection.
   * @param index - The index description.
   * @returns The name of the index.
   * @throws {TypemoError} The driver's error, classified into the Typemo hierarchy.
   */
  static async createIndex(collection: Collection<Doc>, index: IndexDescription): Promise<string> {
    try {
      const [name] = await collection.createIndexes([index]);
      return name ?? "";
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
  }

  /**
   * Drops one index by name.
   *
   * @param collection - The driver collection.
   * @param name - The index name.
   * @throws {TypemoError} The driver's error, classified into the Typemo hierarchy.
   */
  static async dropIndex(collection: Collection<Doc>, name: string): Promise<void> {
    try {
      await collection.dropIndex(name);
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
  }

  /**
   * Creates a collection; `false` when it already exists. The server (7.0+) answers `create` of an
   * existing collection with ok, so existence is checked first (and code 48 of a race is `false` too).
   *
   * @param ctx - Holds the driver database.
   * @param name - The collection name.
   * @param options - The driver's create options.
   * @returns `true` when the collection was created, `false` when it existed.
   * @throws {TypemoError} The driver's error, classified into the Typemo hierarchy.
   */
  static async createCollection(
    ctx: { readonly db: import("mongodb").Db },
    name: string,
    options: CreateCollectionOptions,
  ): Promise<boolean> {
    try {
      const existing = await ctx.db.listCollections({ name }, { nameOnly: true }).toArray();
      if (existing.length > 0) return false;
      await ctx.db.createCollection(name, options);
      return true;
    } catch (error) {
      if (ErrorTranslator.codeOf(error) === 48) return false;
      throw ErrorTranslator.wrap(error);
    }
  }
}

/**
 * `ctx.locals` key: the explain verbosity of an aggregation.
 *
 * @example
 * ctx.locals.set(EXPLAIN_VERBOSITY, "executionStats");
 */
export const EXPLAIN_VERBOSITY = Symbol("explainVerbosity");
