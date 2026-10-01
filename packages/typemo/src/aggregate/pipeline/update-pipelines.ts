import { QueryError } from "../../errors/query-error.ts";
import type { PipelineDoc } from "../types/doc-shape.ts";
import type { PipelineStage } from "./aggregate-plan.ts";
import { PipelineBuilder, type StagedPipeline } from "./pipeline-builder.ts";

/*
 * Update pipelines for the query layer (`updateOne(filter, (p) => p.set(...))`): the callback receives a builder in
 * "update" mode — only `$addFields`, `$set`, `$project`, `$unset`, `$replaceRoot`, `$replaceWith` exist there (the
 * server's rule for update pipelines) — over the stored document of `T`.
 */

/**
 * The update-pipeline callback of `updateOne` / `updateMany` / `findOneAndUpdate` over entity `T`.
 *
 * @typeParam T - The entity type.
 * @example
 * ```ts
 * const update: UpdatePipelineFor<User> = (p) => p.set((f) => ({ name: fn.toUpper(f.name) }));
 * ```
 */
export type UpdatePipelineFor<T> = (p: PipelineBuilder<PipelineDoc<T>, "update", "empty">) => StagedPipeline;

/** Compiles update-pipeline callbacks. */
export class UpdatePipelines {
  /**
   * The stages of an update-pipeline callback (at least one).
   *
   * @typeParam T - The entity type.
   * @param build - The callback that builds the update pipeline.
   * @returns The serialized stages.
   * @throws {QueryError} When the callback adds no stage (like the other errors of an update: the input of one call,
   *   not the setup of the application).
   */
  static compile<T>(build: UpdatePipelineFor<T>): readonly PipelineStage[] {
    const builder = build(new PipelineBuilder<PipelineDoc<T>, "update", "empty">(undefined, [], {}));
    if (builder.stageCount === 0) throw new QueryError("an update pipeline needs at least one stage");
    return builder.build();
  }
}
