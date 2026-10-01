import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";

/*
 * Stage names for the walks of the policies over a pipeline: the name of a stage without an array per stage,
 * and one shared answer for "does this pipeline join anything" — without a join, the tenant, soft delete and
 * Hidden policies have nothing to do past the start of the pipeline.
 */

/** Stages through which a policy reaches other collections, sub-pipelines or write targets. */
const JOIN_STAGES: ReadonlySet<string> = new Set(["$lookup", "$unionWith", "$graphLookup", "$facet", "$out", "$merge"]);

/** Names of pipeline stages. */
export class StageNames {
  /**
   * The stages that must be the first of a pipeline: what a policy adds at the start (the `$unset` of `Hidden`
   * fields, a scope `$match`) goes right after them.
   */
  static readonly FIRST_ONLY: ReadonlySet<string> = new Set([
    "$geoNear",
    "$search",
    "$searchMeta",
    "$vectorSearch",
    "$rankFusion",
    "$scoreFusion",
    "$collStats",
    "$indexStats",
    "$planCacheStats",
    "$listSearchIndexes",
    "$listSessions",
    "$documents",
    "$currentOp",
    "$changeStream",
  ]);

  /**
   * The stage's name: its first own enumerable key (`Object.keys(stage)[0]`, without the array).
   *
   * @param stage - A pipeline stage.
   * @returns The name, for example `"$match"`; `undefined` for an empty stage.
   */
  static first(stage: PipelineStage): string | undefined {
    for (const key in stage) if (Object.hasOwn(stage, key)) return key;
    return undefined;
  }

  /**
   * `true` when a top-level stage joins, nests a pipeline or writes elsewhere (`$lookup`, `$unionWith`,
   * `$graphLookup`, `$facet`, `$out`, `$merge`): the only places the policies look at past the start.
   *
   * @param stages - The top-level stages of a pipeline.
   * @returns Whether any stage joins, nests a pipeline or writes elsewhere.
   */
  static hasJoins(stages: readonly PipelineStage[]): boolean {
    for (const stage of stages) {
      for (const key in stage) if (Object.hasOwn(stage, key) && JOIN_STAGES.has(key)) return true;
    }
    return false;
  }
}
