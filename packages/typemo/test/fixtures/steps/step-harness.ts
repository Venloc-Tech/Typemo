/*
 * Test harness of the pipeline steps: builds an `OperationContext` for a plan (no connection: the steps never
 * call the driver), runs the steps in order, and — for runtime tests — sends the result
 * through the raw driver exactly as the context holds it (what a real `execute` sends).
 */
import type { Collection, Db, Document } from "mongodb";
import type { AggregatePlan } from "../../../src/aggregate/pipeline/aggregate-plan.ts";
import {
  CastStep,
  type CompiledSchema,
  DefaultsStep,
  NormalizeStep,
  type OperationPlan,
  type PlanExecutor,
  PolicyStep,
  type QueryCursor,
  ResolvePathsStep,
  SchemaCompiler,
  ValidateStep,
} from "../../../src/internal.ts";
import type { ExecutionPlan, InsertPlan } from "../../../src/operation/pipeline/execution-plan.ts";
import { OperationContext, type OperationEnvironment } from "../../../src/operation/pipeline/operation-context.ts";
import type { OperationStep } from "../../../src/operation/pipeline/operation-step.ts";
import { EncodeStep } from "../../../src/operation/steps/encode-step.ts";
import type { EntityClass } from "../../../src/schema/options/type-spec.ts";

/** An executor that only records the plans (builders hand them over on `await`). */
export class PlanCapture implements PlanExecutor {
  readonly plans: OperationPlan[] = [];

  /**
   * Records the plan instead of running it.
   *
   * @param plan - the plan a builder handed over
   * @returns an empty array for `find`, else `null`
   */
  async execute(plan: OperationPlan): Promise<unknown> {
    this.plans.push(plan);
    return plan.op === "find" ? [] : null;
  }

  /**
   * Records the plan of a cursor read.
   *
   * @param plan - the plan a builder handed over
   * @returns an empty stand-in cursor
   */
  cursor(plan: OperationPlan): QueryCursor<unknown> {
    this.plans.push(plan);
    /* cast: the steps never open cursors; the shape of the real cursor is irrelevant here */
    return { async *[Symbol.asyncIterator]() {} } as unknown as QueryCursor<unknown>;
  }

  /**
   * The plan of an awaited builder.
   *
   * @param query - a builder (awaiting it hands its plan to this executor)
   * @returns the plan that was captured last
   * @throws when nothing was captured
   */
  async plan(query: PromiseLike<unknown>): Promise<OperationPlan> {
    await query;
    const plan = this.plans.at(-1);
    if (plan === undefined) throw new Error("no plan captured");
    return plan;
  }
}

/**
 * The steps that run before a plan is sent, in pipeline order.
 *
 * @returns fresh step instances
 */
export const STEPS_6B = (): readonly OperationStep[] => [
  new NormalizeStep(),
  new ResolvePathsStep(),
  new CastStep(),
  new PolicyStep(),
  new DefaultsStep(),
  new ValidateStep(),
];

/** Static helpers that build contexts and run the steps over them. */
export class StepHarness {
  /**
   * A context for `plan` (collections of `models` are known to `$lookup`).
   *
   * @param plan - the plan to run
   * @param models - further entities whose collections a `$lookup` may name
   * @returns the operation context
   */
  static context(plan: ExecutionPlan, models: readonly EntityClass[] = []): OperationContext {
    const schema = SchemaCompiler.compileModel(plan.entity);
    const known = new Map<string, CompiledSchema>(
      [plan.entity, ...models].map((entity) => {
        const compiled = SchemaCompiler.compileModel(entity);
        return [compiled.collection, compiled.root] as const;
      }),
    );
    const environment = {
      ready: async (): Promise<void> => {},
      driver: {} as never,
      instrumentation: { enabled: false },
      connectionName: "test",
      schemaOfCollection: (collection: string) => known.get(collection),
    };
    return new OperationContext({
      plan,
      mode: "run",
      target: { entity: plan.entity, schema, collection: schema.collection, database: "test" },
      /* cast: the steps use only `schemaOfCollection`; the rest of the environment belongs to the executor */
      environment: environment as unknown as OperationEnvironment,
    });
  }

  /**
   * Runs the steps (all, or up to and including `until`).
   *
   * @param ctx - the context to run over
   * @param until - the name of the last step to run
   * @returns the same context
   */
  static async run(ctx: OperationContext, until?: string): Promise<OperationContext> {
    for (const step of STEPS_6B()) {
      await step.run(ctx);
      if (step.name === until) break;
    }
    return ctx;
  }

  /**
   * Runs the steps up to `cast` and returns the context (code form, cast values).
   *
   * @param plan - the plan to run
   * @param models - further entities whose collections a `$lookup` may name
   * @returns the context after the `cast` step
   */
  static async cast(plan: ExecutionPlan, models: readonly EntityClass[] = []): Promise<OperationContext> {
    return StepHarness.run(StepHarness.context(plan, models), "cast");
  }

  /**
   * Runs every step (database form).
   *
   * @param plan - the plan to run
   * @param models - further entities whose collections a `$lookup` may name
   * @returns the context after the last step
   */
  static async full(plan: ExecutionPlan, models: readonly EntityClass[] = []): Promise<OperationContext> {
    return StepHarness.run(StepHarness.context(plan, models));
  }

  /**
   * An insert plan.
   *
   * @param entity - the entity to insert into
   * @param documents - the documents to insert
   * @param ordered - whether the insert is ordered
   * @returns a frozen `insertOne` or `insertMany` plan
   */
  static insert(entity: EntityClass, documents: readonly Record<string, unknown>[], ordered = true): InsertPlan {
    return Object.freeze({
      op: documents.length === 1 && ordered ? "insertOne" : "insertMany",
      entity,
      documents: Object.freeze(documents.map((document) => Object.freeze({ ...document }))),
      ordered,
      options: Object.freeze({}),
    });
  }

  /**
   * The execution plan of a builder's aggregation plan.
   *
   * @param entity - the entity the pipeline starts from
   * @param plan - the builder's plan
   * @returns a frozen `aggregate` plan
   */
  static aggregate(entity: EntityClass, plan: AggregatePlan<unknown>): ExecutionPlan {
    return Object.freeze({
      op: "aggregate",
      entity,
      pipeline: plan.pipeline,
      aggregateOptions: plan.options,
      options: Object.freeze({}),
    });
  }

  /**
   * Runs the encode step (code form to database form).
   *
   * @param ctx - the context to encode
   */
  static encode(ctx: OperationContext): void {
    new EncodeStep().run(ctx);
  }
}

/** Sends a context in database form through the raw driver (the minimal `execute` of the runtime tests). */
export class RawExecute {
  /**
   * The driver collection of a context.
   *
   * @param db - the test database
   * @param ctx - the context whose target is wanted
   * @returns the collection
   */
  static collection(db: Db, ctx: OperationContext): Collection<Document> {
    return db.collection(ctx.target.collection);
  }

  /**
   * Sends the context's operation to the server.
   *
   * @param db - the test database
   * @param ctx - a context in database form
   * @returns the driver's result
   * @throws when the operation is not covered by this executor
   */
  static async run(db: Db, ctx: OperationContext): Promise<unknown> {
    const collection = RawExecute.collection(db, ctx);
    const filter = (ctx.filter ?? {}) as Document;
    /* cast: a test double / bridge — the plan read as a record by the harness */
    const plan = ctx.plan as unknown as Record<string, unknown>;
    const sort = ctx.sort === undefined ? undefined : (Object.fromEntries(ctx.sort) as Document);
    const find = {
      ...(ctx.projection === undefined ? {} : { projection: ctx.projection as Document }),
      ...(sort === undefined ? {} : { sort }),
      ...(typeof plan.limit === "number" ? { limit: plan.limit } : {}),
      ...(typeof plan.skip === "number" ? { skip: plan.skip } : {}),
    };
    const write = {
      upsert: plan.upsert === true,
      ...(ctx.arrayFilters === undefined ? {} : { arrayFilters: ctx.arrayFilters as Document[] }),
    };
    switch (ctx.op) {
      case "find":
        return collection.find(filter, find).toArray();
      case "findOne":
        return collection.findOne(filter, find);
      case "countDocuments":
        return collection.countDocuments(filter);
      case "distinct":
        return collection.distinct(ctx.locals.get(EncodeStep.DISTINCT_FIELD) as string, filter);
      case "updateOne":
        return collection.updateOne(filter, ctx.update as Document, write);
      case "updateMany":
        return collection.updateMany(filter, ctx.update as Document, write);
      case "replaceOne":
        return collection.replaceOne(filter, ctx.replacement as Document, { upsert: plan.upsert === true });
      case "deleteOne":
        return collection.deleteOne(filter);
      case "deleteMany":
        return collection.deleteMany(filter);
      case "findOneAndUpdate":
        return collection.findOneAndUpdate(filter, ctx.update as Document, {
          ...write,
          ...(ctx.projection === undefined ? {} : { projection: ctx.projection as Document }),
          returnDocument: plan.returnDocument === "before" ? "before" : "after",
        });
      case "findOneAndDelete":
        return collection.findOneAndDelete(filter);
      case "insertOne":
      case "insertMany":
        return collection.insertMany([...(ctx.documents ?? [])] as Document[]);
      case "aggregate":
        return collection.aggregate([...(ctx.pipeline ?? [])] as Document[]).toArray();
      default:
        throw new Error(`RawExecute: ${ctx.op} is not covered by the test executor`);
    }
  }
}
