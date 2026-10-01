/*
 * A TEST-ONLY executor of query plans over the raw driver (the real executor is the operation
 * pipeline). It proves two things: the server accepts the filters, updates and projections
 * the builders produce, and the shape of what comes back matches the computed result type (shape tests).
 *
 * It does what the pipeline will do for these tests only: the effective projection (`Hidden` fields out,
 * `+field` in — `ProjectionPlanner.effective`), sort/skip/limit, find-and-modify options, and a MINIMAL
 * populate (top-level `Ref`/`Ref[]` paths and virtuals, one level, lean) so populated shapes can be
 * compared. No casting (the tests pass proper BSON values), no hydration (results are the driver's
 * documents), no policies, no `dbName` mapping.
 */
import type { Db, Document, Filter as DriverFilter, FindOptions, Sort, UpdateFilter } from "mongodb";
import {
  type CursorSource,
  type FindPlan,
  type ModifyPlan,
  type OperationPlan,
  type PlanExecutor,
  type PopulatePlan,
  ProjectionPlanner,
  SchemaCompiler,
  type ValuePlan,
  type WritePlan,
} from "../../../src/internal.ts";
import type { EntityClass } from "../../../src/schema/options/type-spec.ts";

/** One recorded run: the plan the runner executed. */
type Executed = { readonly plan: OperationPlan };

/** Executes plans against one database; records every plan it ran. */
export class PlanRunner implements PlanExecutor {
  readonly runs: Executed[] = [];

  /** @param db - returns the database to run against (read lazily, when a plan runs) */
  constructor(private readonly db: () => Db) {}

  /**
   * The driver collection of an entity.
   *
   * @param entity - the entity class
   * @returns the collection named by its compiled schema
   */
  private collection(entity: EntityClass) {
    return this.db().collection(SchemaCompiler.compile(entity).collection);
  }

  /**
   * The driver's find options of a plan (effective projection, sort, paging, session and query options).
   *
   * @param plan - a find or find-and-modify plan
   * @returns the options to hand to the driver
   */
  private options(plan: FindPlan | ModifyPlan): FindOptions {
    const projection = ProjectionPlanner.effective(SchemaCompiler.compile(plan.entity), plan.projection);
    const { session, hint, collation, comment, timeoutMS, batchSize, allowDiskUse, readPreference } = plan.options;
    return {
      ...(projection === undefined ? {} : { projection: projection as Document }),
      /* cast: a test double / bridge — the plan's sort pairs handed to the driver's Sort */
      ...(plan.sort === undefined ? {} : { sort: plan.sort as unknown as Sort }),
      ...("skip" in plan && plan.skip !== undefined ? { skip: plan.skip } : {}),
      ...("limit" in plan && plan.limit !== undefined ? { limit: plan.limit } : {}),
      ...(session == null ? {} : { session }),
      ...(hint === undefined ? {} : { hint: hint as Document }),
      ...(collation === undefined ? {} : { collation }),
      ...(comment === undefined ? {} : { comment }),
      ...(timeoutMS === undefined ? {} : { timeoutMS }),
      ...(batchSize === undefined ? {} : { batchSize }),
      ...(allowDiskUse === undefined ? {} : { allowDiskUse }),
      ...(readPreference === undefined ? {} : { readPreference }),
    };
  }

  /**
   * Runs a plan against the database.
   *
   * @param plan - the plan a builder handed over
   * @returns the driver's result, populated where the plan asks for it
   */
  async execute(plan: OperationPlan): Promise<unknown> {
    this.runs.push({ plan });
    switch (plan.op) {
      case "find":
      case "findOne":
        return this.find(plan);
      case "countDocuments":
      case "estimatedDocumentCount":
      case "distinct":
        return this.value(plan);
      case "findOneAndUpdate":
      case "findOneAndReplace":
      case "findOneAndDelete":
        return this.modify(plan);
      default:
        return this.write(plan);
    }
  }

  /**
   * Opens a cursor over a find plan.
   *
   * @param plan - the find plan
   * @returns an async iterable of documents
   */
  cursor(plan: FindPlan): CursorSource<unknown> {
    this.runs.push({ plan });
    const collection = this.collection(plan.entity);
    const runner = this;
    return {
      async *[Symbol.asyncIterator]() {
        for await (const doc of collection.find(plan.filter as DriverFilter<Document>, runner.options(plan))) {
          yield (await runner.populate(plan.entity, [doc], plan.populate))[0];
        }
      },
    };
  }

  /**
   * Runs a `find` or `findOne` plan.
   *
   * @param plan - the find plan
   * @returns the populated documents, one document or `null`, or the explain output
   */
  private async find(plan: FindPlan): Promise<unknown> {
    const collection = this.collection(plan.entity);
    const filter = plan.filter as DriverFilter<Document>;
    if (plan.mode.kind === "explain") return collection.find(filter, this.options(plan)).explain(plan.mode.verbosity);
    if (plan.op === "findOne") {
      const doc = await collection.findOne(filter, this.options(plan));
      if (doc === null) {
        if (plan.orFail) throw new Error("DocumentNotFound (test runner)");
        return null;
      }
      return (await this.populate(plan.entity, [doc], plan.populate))[0];
    }
    const docs = await collection.find(filter, this.options(plan)).toArray();
    return this.populate(plan.entity, docs, plan.populate);
  }

  /**
   * Runs a count or `distinct` plan.
   *
   * @param plan - the value plan
   * @returns the count or the distinct values
   */
  private async value(plan: ValuePlan): Promise<unknown> {
    const collection = this.collection(plan.entity);
    const filter = plan.filter as DriverFilter<Document>;
    const { session, comment, timeoutMS, hint, collation } = plan.options;
    const common = {
      ...(session == null ? {} : { session }),
      ...(comment === undefined ? {} : { comment }),
      ...(timeoutMS === undefined ? {} : { timeoutMS }),
      ...(collation === undefined ? {} : { collation }),
    };
    if (plan.op === "countDocuments") {
      return collection.countDocuments(filter, {
        ...common,
        ...(hint === undefined ? {} : { hint: hint as Document }),
        ...(plan.skip === undefined ? {} : { skip: plan.skip }),
        ...(plan.limit === undefined ? {} : { limit: plan.limit }),
      });
    }
    if (plan.op === "estimatedDocumentCount") return collection.estimatedDocumentCount(common);
    return collection.distinct(plan.field ?? "", filter, common);
  }

  /**
   * Runs an update, replace or delete plan.
   *
   * @param plan - the write plan
   * @returns the driver's write result
   */
  private async write(plan: WritePlan): Promise<unknown> {
    const collection = this.collection(plan.entity);
    const filter = plan.filter as DriverFilter<Document>;
    const { session, comment, timeoutMS, hint, collation, writeConcern } = plan.options;
    const options = {
      ...(session == null ? {} : { session }),
      ...(comment === undefined ? {} : { comment }),
      ...(timeoutMS === undefined ? {} : { timeoutMS }),
      ...(hint === undefined ? {} : { hint: hint as Document }),
      ...(collation === undefined ? {} : { collation }),
      ...(writeConcern === undefined ? {} : { writeConcern }),
      ...(plan.arrayFilters === undefined ? {} : { arrayFilters: plan.arrayFilters as Document[] }),
      upsert: plan.upsert,
    };
    const update = plan.update as UpdateFilter<Document>;
    switch (plan.op) {
      case "updateOne":
        return collection.updateOne(filter, update, options);
      case "updateMany":
        return collection.updateMany(filter, update, options);
      case "replaceOne":
        return collection.replaceOne(filter, plan.replacement as Document, options);
      case "deleteOne":
        return collection.deleteOne(filter, options);
      default:
        return collection.deleteMany(filter, options);
    }
  }

  /**
   * Runs a find-and-modify plan.
   *
   * @param plan - the modify plan
   * @returns the populated document, `null`, or the raw result when metadata was requested
   */
  private async modify(plan: ModifyPlan): Promise<unknown> {
    const collection = this.collection(plan.entity);
    const filter = plan.filter as DriverFilter<Document>;
    const base = this.options(plan);
    const options = {
      ...(base.projection === undefined ? {} : { projection: base.projection }),
      ...(base.sort === undefined ? {} : { sort: base.sort }),
      ...(plan.options.session == null ? {} : { session: plan.options.session }),
      ...(plan.arrayFilters === undefined ? {} : { arrayFilters: plan.arrayFilters as Document[] }),
      includeResultMetadata: plan.includeResultMetadata,
    };
    const raw =
      plan.op === "findOneAndUpdate"
        ? await collection.findOneAndUpdate(filter, plan.update as UpdateFilter<Document>, {
            ...options,
            upsert: plan.upsert,
            returnDocument: plan.returnDocument,
          })
        : plan.op === "findOneAndReplace"
          ? await collection.findOneAndReplace(filter, plan.replacement as Document, {
              ...options,
              upsert: plan.upsert,
              returnDocument: plan.returnDocument,
            })
          : await collection.findOneAndDelete(filter, options);
    if (plan.includeResultMetadata) return raw;
    const doc = raw as Document | null;
    if (doc === null) return null;
    return (await this.populate(plan.entity, [doc], plan.populate))[0];
  }

  /**
   * One level of populate on top-level refs and virtuals (enough for the query shape tests).
   *
   * @param entity - the entity of the documents
   * @param docs - the documents to populate (copied, not mutated)
   * @param populate - the populate entries of the plan
   * @returns the populated copies
   * @throws when a path is nested, not a reference, or unknown
   */
  private async populate(
    entity: EntityClass,
    docs: Document[],
    populate: readonly PopulatePlan[],
  ): Promise<Document[]> {
    if (populate.length === 0) return docs;
    const schema = SchemaCompiler.compile(entity);
    const out = docs.map((doc) => ({ ...doc }));
    for (const entry of populate) {
      if (entry.path.includes(".")) throw new Error(`test runner: nested populate "${entry.path}" is stage 8`);
      const node = schema.field(entry.path);
      const virtual = schema.virtuals.find(
        (candidate) => candidate.key === entry.path && candidate.kind === "populate",
      );
      const projection = (target: EntityClass) =>
        ProjectionPlanner.effective(SchemaCompiler.compile(target), entry.select);
      if (node !== undefined) {
        const target = (node.kind === "array" ? node.element.ref : node.ref)?.();
        if (target === undefined) throw new Error(`test runner: "${entry.path}" is not a reference`);
        const ids = out
          .flatMap((doc) => (Array.isArray(doc[entry.path]) ? doc[entry.path] : [doc[entry.path]]))
          .filter((id) => id != null);
        const found = await this.collection(target as EntityClass)
          .find(
            { _id: { $in: ids }, ...(entry.match ?? {}) },
            { projection: projection(target as EntityClass) as Document },
          )
          .toArray();
        const byId = new Map(found.map((doc) => [String(doc._id), doc]));
        for (const doc of out) {
          const value = doc[entry.path];
          if (Array.isArray(value))
            doc[entry.path] = value.map((id) => byId.get(String(id))).filter((d) => d !== undefined);
          else if (value != null) doc[entry.path] = byId.get(String(value)) ?? null;
        }
      } else if (virtual !== undefined && virtual.kind === "populate") {
        const options = virtual.options;
        const target = options.ref() as EntityClass;
        const locals = out.map((doc) => doc[options.localField]);
        const found = await this.collection(target)
          .find(
            { [options.foreignField]: { $in: locals }, ...(entry.match ?? {}) },
            { projection: projection(target) as Document },
          )
          .toArray();
        for (const doc of out) {
          const mine = found.filter((other) => String(other[options.foreignField]) === String(doc[options.localField]));
          doc[entry.path] = options.count === true ? mine.length : options.justOne === true ? (mine[0] ?? null) : mine;
        }
      } else {
        throw new Error(`test runner: unknown populate path "${entry.path}"`);
      }
    }
    return out;
  }
}
