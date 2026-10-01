import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import { QueryError } from "../errors/query-error.ts";
import { SafeRecord } from "../internal/safe-record.ts";
import type { OperationName } from "../operation/pipeline/execution-plan.ts";
import type { OperationContext, ValuesSnapshot } from "../operation/pipeline/operation-context.ts";
import type { PlanDocument, SortPair } from "../query/plan.ts";
import { PlanValues } from "../query/plan-values.ts";
import { ProjectionPlanner } from "../query/projection-planner.ts";
import { QuerySpecs } from "../query/query-specs.ts";
import { UpdatePlanner } from "../query/update-planner.ts";
import type { OperationChanges } from "./hook-events.ts";

/**
 * The values of an operation a pre hook can change, in code form (the user's input, before any pipeline step).
 *
 * @example
 * ```ts
 * const values: CodeValues = { filter: { age: 1 }, update: undefined, arrayFilters: undefined,
 *   projection: undefined, sort: undefined, pipeline: undefined };
 * ```
 */
export interface CodeValues {
  /** The filter. */
  readonly filter: PlanDocument | undefined;
  /** The update document or update pipeline. */
  readonly update: PlanDocument | readonly PlanDocument[] | undefined;
  /** The `arrayFilters` of an update. */
  readonly arrayFilters: readonly PlanDocument[] | undefined;
  /** The projection. */
  readonly projection: PlanDocument | undefined;
  /** The sort pairs. */
  readonly sort: readonly SortPair[] | undefined;
  /** The aggregation stages. */
  readonly pipeline: readonly PipelineStage[] | undefined;
}

type ChangeKey = keyof OperationChanges<unknown>;

const FILTERED: readonly OperationName[] = [
  "find",
  "findOne",
  "countDocuments",
  "distinct",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
];
const PROJECTED: readonly OperationName[] = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
];

/** The operations each change key applies to (the runtime twin of the `ChangeKeys` type). */
const APPLIES: Readonly<Record<ChangeKey, ReadonlySet<OperationName>>> = {
  where: new Set(FILTERED),
  update: new Set<OperationName>(["updateOne", "updateMany", "findOneAndUpdate"]),
  select: new Set(PROJECTED),
  sort: new Set(PROJECTED),
  stages: new Set<OperationName>(["aggregate"]),
};

type Loose = Partial<Record<string, unknown>>;

/**
 * Changes a pre hook makes to an operation, at its own risk but never around a policy.
 *
 * A change is made to the operation's values in code form (the plan: the user's input, before any step), not to
 * the database form the hook reads. Those values then go through the value steps again (normalize, resolve paths,
 * cast, policies, defaults, validate and encode), exactly as if the user had built the changed operation, so every
 * rule and policy applies to the whole of it. Each change is checked like the same input to a query builder and
 * fails with a `QueryError` at the hook's call.
 */
export class HookChanges {
  /**
   * The code-form values of the operation as the user built it.
   *
   * @param ctx - The operation context.
   * @returns The values taken from the plan.
   */
  static initial(ctx: OperationContext): CodeValues {
    const plan = ctx.plan as unknown as Loose;
    return {
      filter: plan.filter as PlanDocument | undefined,
      update: plan.update as PlanDocument | readonly PlanDocument[] | undefined,
      arrayFilters: plan.arrayFilters as readonly PlanDocument[] | undefined,
      projection: plan.projection as PlanDocument | undefined,
      sort: plan.sort as readonly SortPair[] | undefined,
      pipeline: plan.pipeline as readonly PipelineStage[] | undefined,
    };
  }

  /**
   * Applies a change to the current values. The change is checked like builder input; it is copied, never kept.
   *
   * @param ctx - The operation context.
   * @param current - The values before the change.
   * @param change - The hook's change object (`where`, `update`, `select`, `sort`, `stages`).
   * @param op - The operation the change is for: the context's, or one operation of a `bulkWrite`.
   * @param label - How the operation is named in messages.
   * @returns The new values, or `current` itself when nothing changed.
   * @throws {QueryError} When the change is not an object, has an unknown key, does not apply to the operation, or
   * holds an invalid value.
   */
  static apply(
    ctx: OperationContext,
    current: CodeValues,
    change: unknown,
    op: OperationName = ctx.op,
    label = `${ctx.target.entity.name}.${op}`,
  ): CodeValues {
    const where = `${label}: modify()`;
    if (!BsonGuards.isPlainObject(change)) throw new QueryError(`${where} takes an object of changes`);
    let next = current;
    for (const key of Object.keys(change)) {
      const applies = APPLIES[key as ChangeKey] as ReadonlySet<OperationName> | undefined;
      if (applies === undefined || !Object.hasOwn(APPLIES, key)) {
        throw new QueryError(`${where}: unknown change "${key}" (where, update, select, sort, stages)`, { path: key });
      }
      if (!applies.has(op)) {
        throw new QueryError(`${where}: "${key}" does not apply to ${op}`, { path: key });
      }
      const value = change[key];
      if (value === undefined) continue;
      switch (key as ChangeKey) {
        case "where":
          next = { ...next, filter: HookChanges.where(next.filter, value, where) };
          break;
        case "update":
          next = { ...next, ...HookChanges.update(next, value, where) };
          break;
        case "select":
          next = { ...next, projection: ProjectionPlanner.check(HookChanges.record(value, "select", where)) };
          break;
        case "sort":
          next = { ...next, sort: QuerySpecs.sort(value) };
          break;
        case "stages":
          next = { ...next, pipeline: HookChanges.stages(next.pipeline, value, where) };
          break;
      }
    }
    return next;
  }

  /**
   * Puts the context back as it was before the value steps, then sets the changed code-form values, so the steps
   * can run again from them. The whole snapshot is restored (every working value, `locals` and the rejected
   * documents) instead of a list of what steps derived, so no derived value can be left behind. The inputs hooks
   * cannot change come back from the plan held in the snapshot.
   *
   * @param ctx - The operation context.
   * @param snapshot - The snapshot taken before the value steps.
   * @param values - The changed code-form values.
   */
  static restore(ctx: OperationContext, snapshot: ValuesSnapshot, values: CodeValues): void {
    ctx.restoreValues(snapshot);
    ctx.filter = values.filter;
    ctx.update = values.update;
    ctx.arrayFilters = values.arrayFilters;
    ctx.projection = values.projection;
    ctx.sort = values.sort;
    ctx.pipeline = values.pipeline;
  }

  /**
   * Checks that a change value is a plain object.
   *
   * @param value - The value to check.
   * @param what - The change key, for the error.
   * @param where - `Model.operation: modify()`, for the error.
   * @returns The value as a record.
   * @throws {QueryError} When the value is not a plain object.
   */
  private static record(value: unknown, what: string, where: string): Readonly<Record<string, unknown>> {
    if (!BsonGuards.isPlainObject(value)) throw new QueryError(`${where}: "${what}" is an object`, { path: what });
    return value;
  }

  /**
   * The filter combined with the hook's condition: disjoint keys side by side, otherwise `$and`, as `where()` of a
   * builder does.
   *
   * @param filter - The current filter.
   * @param value - The hook's condition.
   * @param where - `Model.operation: modify()`, for the error.
   * @returns The combined filter.
   * @throws {QueryError} When the condition is not a valid filter object.
   */
  private static where(filter: PlanDocument | undefined, value: unknown, where: string): PlanDocument {
    return PlanValues.combine([
      filter ?? Object.freeze({}),
      PlanValues.filter(HookChanges.record(value, "where", where), "where"),
    ]);
  }

  /**
   * The hook's operators merged into the update, with the whole update checked again by the update planner (for
   * example, two operators writing the same path conflict as they do on the server).
   *
   * @param current - The current values.
   * @param value - The operators to add.
   * @param where - `Model.operation: modify()`, for the error.
   * @returns The new `update` and `arrayFilters`.
   * @throws {QueryError} When the update is a pipeline, a path is already written, or the merged update is invalid.
   */
  private static update(
    current: CodeValues,
    value: unknown,
    where: string,
  ): Pick<CodeValues, "update" | "arrayFilters"> {
    const added = HookChanges.record(value, "update", where);
    const update = current.update;
    if (update === undefined || Array.isArray(update)) {
      throw new QueryError(`${where}: "update" merges operators into an update of operators, not an update pipeline`, {
        path: "update",
      });
    }
    const base = update as PlanDocument;
    /* Every key goes through `SafeRecord.set` and is read with `hasOwn`: an own `__proto__` key of the hook's
       input (from `JSON.parse`) is an operator the planner refuses with a `QueryError`, never a prototype swap
       that would drop the change silently. */
    const merged: Record<string, unknown> = {};
    for (const operator of Object.keys(base)) SafeRecord.set(merged, operator, base[operator]);
    for (const operator of Object.keys(added)) {
      const own = Object.hasOwn(base, operator) ? base[operator] : undefined;
      const extra = added[operator];
      if (!BsonGuards.isPlainObject(own) || !BsonGuards.isPlainObject(extra)) {
        SafeRecord.set(merged, operator, extra);
        continue;
      }
      const paths: Record<string, unknown> = {};
      for (const path of Object.keys(own)) SafeRecord.set(paths, path, own[path]);
      for (const path of Object.keys(extra)) {
        if (Object.hasOwn(paths, path)) {
          throw new QueryError(`${where}: "${operator}.${path}" is already written by the update`, {
            path: `${operator}.${path}`,
          });
        }
        SafeRecord.set(paths, path, extra[path]);
      }
      SafeRecord.set(merged, operator, paths);
    }
    const planned = UpdatePlanner.plan(merged, current.arrayFilters);
    return { update: planned.update, arrayFilters: planned.arrayFilters };
  }

  /**
   * The hook's stages appended to the pipeline, each a frozen copy of a plain stage object.
   *
   * @param pipeline - The current stages.
   * @param value - The stages to append.
   * @param where - `Model.operation: modify()`, for the error.
   * @returns The pipeline with the new stages at the end.
   * @throws {QueryError} When `value` is not a list, or a stage is not an object with exactly one key.
   */
  private static stages(
    pipeline: readonly PipelineStage[] | undefined,
    value: unknown,
    where: string,
  ): readonly PipelineStage[] {
    if (!Array.isArray(value)) throw new QueryError(`${where}: "stages" is a list of stages`, { path: "stages" });
    const added = value.map((stage: unknown, index) => {
      if (!BsonGuards.isPlainObject(stage) || Object.keys(stage).length !== 1) {
        throw new QueryError(`${where}: stages.${index} is a stage object with one key`, { path: `stages.${index}` });
      }
      return PlanValues.copy(stage, `stages.${index}`, "modify") as PipelineStage;
    });
    return [...(pipeline ?? []), ...added];
  }
}
