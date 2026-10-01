import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import type { PlanDocument } from "../query/plan.ts";
import { StageNames } from "./stage-names.ts";

/*
 * The shared machinery of the scoping policies (tenant, soft delete). A scope is a CONDITION the policy adds to
 * what the user asked, never in place of it (an older soft delete overwrote a user condition on its own field):
 * - a filter without the field at its top level gets the key next to the user's keys (an upsert then
 *   inserts the scoped value from the filter's equality, and `DefaultsFiller` sees the key pinned);
 * - a filter that has the field gets `{ $and: [user filter, condition] }`;
 * - an aggregation gets a `$match` at its start (after the stages that must be first), and every join —
 *   `$lookup` (with `localField`/`foreignField` too: a sub-pipeline is allowed with them since MongoDB 5.0),
 *   `$unionWith`, `$graphLookup` (`restrictSearchWithMatch`) — gets the condition of the JOINED model, at
 *   any depth (`$facet` branches and sub-pipelines included).
 * Values are in CODE form here (the `policies` slot runs after `cast`, before the encode at the end of
 * `validate`): the encode step translates `dbName`s and encodes the values of the added stages like any other.
 */

/**
 * The scope condition of the documents of a collection (`undefined`: not scoped).
 *
 * @example
 * const scopeOf: ScopeOf = (collection) => (collection === "notes" ? { tenantId: "acme" } : undefined);
 */
export type ScopeOf = (collection: string) => PlanDocument | undefined;

/**
 * What a scoping policy says about the target of `$out`/`$merge`: it throws to refuse.
 *
 * @example
 * const check: WriteTargetCheck = (collection, stage) => {
 *   if (collection === "notes") throw new Error(`${stage} into notes`);
 * };
 */
export type WriteTargetCheck = (collection: string, stage: "$out" | "$merge") => void;

/**
 * Adds scope conditions to filters and pipelines.
 *
 * @example
 * ScopeFilters.filter({ title: "a" }, { tenantId: "acme" }); // { title: "a", tenantId: "acme" }
 */
export class ScopeFilters {
  /**
   * `filter` AND `condition`, keeping every user condition.
   *
   * @param filter - The user's filter, if any.
   * @param condition - The scope condition.
   * @returns A new frozen filter: the keys side by side, or an `$and` when a key is in both.
   */
  static filter(filter: PlanDocument | undefined, condition: PlanDocument): PlanDocument {
    if (filter === undefined || Object.keys(filter).length === 0) return Object.freeze({ ...condition });
    const clash = Object.keys(condition).some((key) => Object.hasOwn(filter, key));
    if (!clash) return Object.freeze({ ...filter, ...condition });
    return Object.freeze({ $and: Object.freeze([filter, Object.freeze({ ...condition })]) });
  }

  /**
   * The stages of an aggregation with `own` (the scope of the collection the pipeline reads; `undefined`: none) at
   * the start and the joined collections scoped by `scopeOf`. The list is a new one only when something changed
   * (a policy copies nothing it does not change), and it is not frozen (it is the context's list of stages).
   *
   * @param stages - The pipeline stages.
   * @param own - The scope condition of the source collection, if any.
   * @param scopeOf - Gives the scope of a joined collection.
   * @param checkWrite - Called for the target of `$out`/`$merge`; it throws to refuse.
   * @returns The scoped stages.
   */
  static pipeline(
    stages: readonly PipelineStage[],
    own: PlanDocument | undefined,
    scopeOf: ScopeOf,
    checkWrite: WriteTargetCheck,
  ): readonly PipelineStage[] {
    const joined = ScopeFilters.joins(stages, scopeOf, checkWrite);
    if (own === undefined) return joined;
    let at = 0;
    while (at < joined.length && StageNames.FIRST_ONLY.has(StageNames.first(joined[at] as PipelineStage) ?? "")) at++;
    const match: PipelineStage = Object.freeze({ $match: Object.freeze({ ...own }) });
    return [...joined.slice(0, at), match, ...joined.slice(at)];
  }

  /**
   * Scopes the joins of `stages` (recursively); `stages` itself when no stage changed.
   *
   * @param stages - The pipeline stages.
   * @param scopeOf - Gives the scope of a joined collection.
   * @param checkWrite - Called for the target of `$out`/`$merge`; it throws to refuse.
   * @returns The stages with their joins scoped.
   */
  static joins(
    stages: readonly PipelineStage[],
    scopeOf: ScopeOf,
    checkWrite: WriteTargetCheck,
  ): readonly PipelineStage[] {
    let out: PipelineStage[] | undefined;
    for (let index = 0; index < stages.length; index++) {
      const stage = stages[index] as PipelineStage;
      const next = ScopeFilters.stage(stage, scopeOf, checkWrite);
      if (next !== stage && out === undefined) out = stages.slice(0, index);
      out?.push(next);
    }
    return out ?? stages;
  }

  /**
   * One stage with its join scoped (the stage itself when nothing is added).
   *
   * @param stage - The stage.
   * @param scopeOf - Gives the scope of a joined collection.
   * @param checkWrite - Called for the target of `$out`/`$merge`; it throws to refuse.
   * @returns The scoped stage, or `stage` itself.
   */
  private static stage(stage: PipelineStage, scopeOf: ScopeOf, checkWrite: WriteTargetCheck): PipelineStage {
    const name = StageNames.first(stage);
    const spec = name === undefined ? undefined : stage[name];
    switch (name) {
      case "$lookup": {
        if (!BsonGuards.isPlainObject(spec)) return stage;
        const condition = typeof spec.from === "string" ? scopeOf(spec.from) : undefined;
        const nested = Array.isArray(spec.pipeline) ? (spec.pipeline as PipelineStage[]) : undefined;
        const inner = nested === undefined ? undefined : ScopeFilters.joins(nested, scopeOf, checkWrite);
        if (condition === undefined && inner === nested) return stage;
        const pipeline =
          condition === undefined
            ? inner
            : [Object.freeze({ $match: Object.freeze({ ...condition }) }), ...(inner ?? [])];
        return Object.freeze({ $lookup: Object.freeze({ ...spec, pipeline: Object.freeze(pipeline ?? []) }) });
      }
      case "$unionWith": {
        const coll = typeof spec === "string" ? spec : BsonGuards.isPlainObject(spec) ? spec.coll : undefined;
        const base = typeof spec === "string" ? { coll: spec } : BsonGuards.isPlainObject(spec) ? spec : undefined;
        if (base === undefined) return stage;
        const condition = typeof coll === "string" ? scopeOf(coll) : undefined;
        const nested = Array.isArray(base.pipeline) ? (base.pipeline as PipelineStage[]) : undefined;
        const inner = nested === undefined ? undefined : ScopeFilters.joins(nested, scopeOf, checkWrite);
        if (condition === undefined && inner === nested) return stage;
        const pipeline =
          condition === undefined
            ? inner
            : [Object.freeze({ $match: Object.freeze({ ...condition }) }), ...(inner ?? [])];
        return Object.freeze({ $unionWith: Object.freeze({ ...base, pipeline: Object.freeze(pipeline ?? []) }) });
      }
      case "$graphLookup": {
        if (!BsonGuards.isPlainObject(spec) || typeof spec.from !== "string") return stage;
        const condition = scopeOf(spec.from);
        if (condition === undefined) return stage;
        const existing = spec.restrictSearchWithMatch;
        const restrict = BsonGuards.isPlainObject(existing)
          ? ScopeFilters.filter(existing, condition)
          : Object.freeze({ ...condition });
        return Object.freeze({ $graphLookup: Object.freeze({ ...spec, restrictSearchWithMatch: restrict }) });
      }
      case "$facet": {
        if (!BsonGuards.isPlainObject(spec)) return stage;
        const facet: Record<string, unknown> = {};
        let changed = false;
        for (const [branch, branchStages] of Object.entries(spec)) {
          const value = Array.isArray(branchStages)
            ? ScopeFilters.joins(branchStages as PipelineStage[], scopeOf, checkWrite)
            : branchStages;
          if (value !== branchStages) changed = true;
          Object.defineProperty(facet, branch, {
            value: Array.isArray(value) ? Object.freeze(value) : value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        return changed ? Object.freeze({ $facet: Object.freeze(facet) }) : stage;
      }
      case "$out":
      case "$merge": {
        const target =
          typeof spec === "string"
            ? spec
            : BsonGuards.isPlainObject(spec)
              ? name === "$out"
                ? spec.coll
                : BsonGuards.isPlainObject(spec.into)
                  ? spec.into.coll
                  : spec.into
              : undefined;
        if (typeof target === "string") checkWrite(target, name);
        return stage;
      }
      default:
        return stage;
    }
  }
}
