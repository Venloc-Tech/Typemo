import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import { ProjectionPlanner } from "../query/projection-planner.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import { StageNames } from "./stage-names.ts";

/*
 * `Hidden` fields are hidden in aggregations too: the core prepends `$unset` of the
 * hidden paths, so no stage sees them and no row carries them — the row types of the pipeline builder
 * have no hidden fields either (`DocOf<Entity>`). Explicit inclusion is like `find`'s `+field`:
 * `Pipeline.from(User, { include: ["passwordHash"] })`. Joined documents are hidden the same way:
 * `$lookup` gets `$unset` at the start of its sub-pipeline (with `localField`/`foreignField` too, MongoDB
 * ≥ 5.0), `$unionWith` at the start of its pipeline, `$graphLookup` (no sub-pipeline) is followed by
 * `$unset` of `<as>.<hidden>`. Paths are CODE paths: the `dbName` translation comes later.
 */

/**
 * Finds the schema of the model stored in a collection.
 *
 * @example
 * const lookup: Lookup = (collection) => registry.get(collection);
 */
type Lookup = (collection: string) => CompiledSchema | undefined;

/** The hidden paths of each schema, computed once. */
const HIDDEN = new WeakMap<CompiledSchema, readonly string[]>();

/**
 * The hidden policy (aggregations).
 *
 * @example
 * const stages = HiddenPolicy.stages([{ $match: {} }], userSchema, [], lookup);
 * // [{ $unset: ["passwordHash"] }, { $match: {} }]
 */
export class HiddenPolicy {
  /** The policy name, as it appears in diagnostics. */
  readonly name = "hidden";

  /**
   * Prepends the `$unset` of the hidden fields to an aggregation (and to its joins).
   *
   * @param ctx - The operation context.
   */
  run(ctx: OperationContext): void {
    if (ctx.op !== "aggregate" || ctx.pipeline === undefined) return;
    const options = OperationView.planField(ctx, "aggregateOptions");
    const include =
      BsonGuards.isPlainObject(options) && Array.isArray(options.include) ? (options.include as string[]) : [];
    ctx.pipeline = HiddenPolicy.stages(ctx.pipeline, OperationView.schema(ctx), include, (collection) =>
      OperationView.schemaOfCollection(ctx, collection),
    );
  }

  /**
   * The hidden code paths of a schema and its discriminators, outermost only. Fixed when the schema is compiled:
   * computed once per schema.
   *
   * @param schema - The compiled schema.
   * @returns The hidden paths that are not inside another hidden field.
   */
  static hiddenPaths(schema: CompiledSchema): readonly string[] {
    const cached = HIDDEN.get(schema);
    if (cached !== undefined) return cached;
    const all = new Set<string>();
    for (const one of [schema, ...schema.discriminators.values()]) {
      for (const path of ProjectionPlanner.hiddenPaths(one)) all.add(path);
    }
    const paths = Object.freeze([...all]);
    HIDDEN.set(schema, paths);
    return paths;
  }

  /**
   * The stages with the hidden fields of the source (minus `include`) and of joined models removed. A new list only
   * when something changed, not frozen (it is the context's list of stages).
   *
   * @param stages - The pipeline stages.
   * @param schema - The schema of the source collection, if known.
   * @param include - Hidden paths to keep (`+path` is accepted).
   * @param lookup - Finds the schemas of joined collections.
   * @returns The stages with `$unset` of the hidden fields added.
   */
  static stages(
    stages: readonly PipelineStage[],
    schema: CompiledSchema | undefined,
    include: readonly string[],
    lookup: Lookup,
  ): readonly PipelineStage[] {
    const hiddenAll = schema === undefined ? [] : HiddenPolicy.hiddenPaths(schema);
    const included =
      include.length === 0 ? undefined : new Set(include.map((path) => (path.startsWith("+") ? path.slice(1) : path)));
    const hidden = included === undefined ? hiddenAll : hiddenAll.filter((path) => !included.has(path));
    const rewritten = HiddenPolicy.joins(stages, lookup);
    if (hidden.length === 0) return rewritten;
    const unset: PipelineStage = Object.freeze({ $unset: Object.freeze([...hidden]) });
    const [first] = rewritten;
    const firstName = first === undefined ? undefined : StageNames.first(first);
    /* A stage that must be the first of a pipeline (`$search`, `$vectorSearch`, `$geoNear`, …) keeps its place. */
    const at = firstName !== undefined && StageNames.FIRST_ONLY.has(firstName) ? 1 : 0;
    return [...rewritten.slice(0, at), unset, ...rewritten.slice(at)];
  }

  /**
   * `$lookup`/`$unionWith`/`$graphLookup` of models with hidden fields, rewritten (recursively); `stages` when none.
   *
   * @param stages - The pipeline stages.
   * @param lookup - Finds the schemas of joined collections.
   * @returns The rewritten stages, or `stages` itself when nothing changed.
   */
  private static joins(stages: readonly PipelineStage[], lookup: Lookup): readonly PipelineStage[] {
    let out: PipelineStage[] | undefined;
    for (let index = 0; index < stages.length; index++) {
      const stage = stages[index] as PipelineStage;
      const next = HiddenPolicy.stage(stage, lookup);
      const unset = HiddenPolicy.graphUnset(stage, lookup);
      if ((next !== stage || unset !== undefined) && out === undefined) out = stages.slice(0, index);
      out?.push(next);
      if (unset !== undefined) out?.push(unset);
    }
    return out ?? stages;
  }

  /**
   * One `$lookup`/`$unionWith`/`$facet` with the hidden fields of the joined model removed (the stage when none).
   *
   * @param stage - The stage.
   * @param lookup - Finds the schemas of joined collections.
   * @returns The rewritten stage, or `stage` itself when nothing changed.
   */
  private static stage(stage: PipelineStage, lookup: Lookup): PipelineStage {
    const name = StageNames.first(stage);
    const spec = name === undefined ? undefined : stage[name];
    if (name === "$lookup" && BsonGuards.isPlainObject(spec)) {
      const foreign = typeof spec.from === "string" ? lookup(spec.from) : undefined;
      const nested = Array.isArray(spec.pipeline) ? (spec.pipeline as PipelineStage[]) : undefined;
      const inner = nested === undefined ? undefined : HiddenPolicy.joins(nested, lookup);
      const hidden = foreign === undefined ? [] : HiddenPolicy.hiddenPaths(foreign);
      if (hidden.length === 0 && inner === nested) return stage;
      const pipeline =
        hidden.length === 0 ? inner : [Object.freeze({ $unset: Object.freeze([...hidden]) }), ...(inner ?? [])];
      return Object.freeze({
        $lookup: Object.freeze({
          ...spec,
          ...(pipeline === undefined ? {} : { pipeline: Object.freeze(pipeline) }),
        }),
      });
    }
    if (name === "$unionWith") {
      const coll = typeof spec === "string" ? spec : BsonGuards.isPlainObject(spec) ? spec.coll : undefined;
      const foreign = typeof coll === "string" ? lookup(coll) : undefined;
      const base = typeof spec === "string" ? { coll: spec } : BsonGuards.isPlainObject(spec) ? spec : {};
      const nested = Array.isArray(base.pipeline) ? (base.pipeline as PipelineStage[]) : undefined;
      const inner = nested === undefined ? undefined : HiddenPolicy.joins(nested, lookup);
      const hidden = foreign === undefined ? [] : HiddenPolicy.hiddenPaths(foreign);
      if (hidden.length === 0 && inner === nested) return stage;
      const pipeline =
        hidden.length === 0 ? (inner ?? []) : [Object.freeze({ $unset: Object.freeze([...hidden]) }), ...(inner ?? [])];
      return Object.freeze({ $unionWith: Object.freeze({ ...base, pipeline: Object.freeze(pipeline) }) });
    }
    if (name === "$facet" && BsonGuards.isPlainObject(spec)) {
      const facet: Record<string, unknown> = {};
      let changed = false;
      for (const [branch, branchStages] of Object.entries(spec)) {
        const value = Array.isArray(branchStages)
          ? HiddenPolicy.joins(branchStages as PipelineStage[], lookup)
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
    return stage;
  }

  /**
   * The `$unset` of `<as>.<hidden>` after a `$graphLookup` of a model with hidden fields (no sub-pipeline there).
   *
   * @param stage - The stage.
   * @param lookup - Finds the schemas of joined collections.
   * @returns The `$unset` stage to add after it, or `undefined`.
   */
  private static graphUnset(stage: PipelineStage, lookup: Lookup): PipelineStage | undefined {
    const spec = stage.$graphLookup;
    if (
      spec === undefined ||
      StageNames.first(stage) !== "$graphLookup" ||
      !BsonGuards.isPlainObject(spec) ||
      typeof spec.from !== "string" ||
      typeof spec.as !== "string"
    ) {
      return undefined;
    }
    const foreign = lookup(spec.from);
    const hidden = foreign === undefined ? [] : HiddenPolicy.hiddenPaths(foreign);
    const as = spec.as;
    return hidden.length > 0
      ? Object.freeze({ $unset: Object.freeze(hidden.map((path) => `${as}.${path}`)) })
      : undefined;
  }
}
