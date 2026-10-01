import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { OperationContext } from "./operation-context.ts";

/**
 * The slots of the pipeline, in run order. The order is fixed.
 *
 * @example
 * ```ts
 * const first: StepName = STEP_ORDER[0];
 * ```
 */
export const STEP_ORDER = [
  "resolveContext",
  "validateOptions",
  "normalize",
  "resolvePaths",
  "cast",
  "policies",
  "defaults",
  "validate",
  "hooksPre",
  "instrumentStart",
  "execute",
  "postProcess",
  "populate",
  "audit",
  "hooksPost",
  "instrumentEnd",
] as const;

/**
 * The name of a pipeline slot.
 *
 * @example
 * ```ts
 * const name: StepName = "cast";
 * ```
 */
export type StepName = (typeof STEP_ORDER)[number];

/**
 * The slots that run BEFORE the driver call (once per operation, also for a cursor).
 *
 * @example
 * ```ts
 * const name: PreStepName = "validate";
 * ```
 */
export type PreStepName = (typeof STEP_ORDER)[number] extends infer N
  ? N extends "execute" | "postProcess" | "populate" | "audit" | "hooksPost" | "instrumentEnd"
    ? never
    : N
  : never;

/**
 * A pipeline step: a class with one `run(ctx)` method, tested on its own. `run` may be synchronous (no promise is
 * created then: most steps are pure
 * transformations of the context). `onError` (optional) runs when ANY step failed: on EVERY step of the
 * pipeline, in reverse order (`ctx.failedStep` names the step that failed; a step checks its own
 * locals to know whether it had run) — `hooksPost` runs the `postError` hooks there (only when the
 * pre hooks ran), `instrumentEnd` emits `operation.error`. An error thrown by `onError` replaces
 * `ctx.error`.
 *
 * For a cursor (`mode: "cursor"`) the steps up to `execute` run once when the cursor opens; the steps
 * after `execute` run once PER BATCH with `ctx.result` holding that batch (the same order as `await`:
 * postProcess, populate, audit, hooksPost: one order everywhere), and
 * `instrumentEnd` runs when the cursor is exhausted or closed.
 *
 * @example
 * ```ts
 * class LogStep implements OperationStep {
 *   readonly name = "audit" as const;
 *   run(ctx: OperationContext): void {
 *     console.log(ctx.op);
 *   }
 * }
 * ```
 */
export interface OperationStep {
  /** The slot the step fills. */
  readonly name: StepName;
  /**
   * Does the work of the step over the context.
   *
   * @param ctx - The context of the operation.
   * @returns Nothing, or a promise when the step is asynchronous.
   * @throws {TypemoError} When the step rejects the operation.
   */
  run(ctx: OperationContext): void | Promise<void>;
  /**
   * Runs when any step failed (see the interface description).
   *
   * @param ctx - The context of the operation; `ctx.error` holds the failure.
   * @returns Nothing, or a promise when the step is asynchronous.
   */
  onError?(ctx: OperationContext): void | Promise<void>;
  /**
   * Tells whether `run` can do anything for models with a schema. `false` when `run` does nothing for EVERY operation
   * of models with this schema, so the
   * pipeline leaves the step out of their run list (decided once per schema). Only what is fixed when the
   * schema is compiled may decide it — hooks, plugins (sealed with the schema), schema options — never
   * per-operation values. `onError` is not affected: it still runs on every step. Absent: always needed.
   *
   * @param schema - The compiled schema of the model.
   * @returns `false` when the step can be left out of the run list.
   */
  needed?(schema: CompiledSchema): boolean;
}
