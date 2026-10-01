import type { Connection } from "../connection/connection.ts";
import { Documents } from "../document/documents.ts";
import { WRITE_OPERATIONS } from "../operation/pipeline/execution-plan.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import type { OperationStep } from "../operation/pipeline/operation-step.ts";
import { PostProcessStep } from "../operation/pipeline/steps/post-process-step.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import type { FindPlan, ModifyPlan } from "../query/plan.ts";
import { PopulateExecutor, type PopulateRun } from "./populate-executor.ts";

/**
 * The `populate` slot of the operation pipeline: runs after postProcess (hydration or lean) and before
 * the post hooks — ONE post-processing path for `find`, `findOne`, `findOneAnd*`, `await` and every cursor
 * batch. Mongoose's `find`/`findOne` lean paths differed, and its cursor populated document by document
 * without `batchSize` (Mongoose H460): here each driver batch is populated with one query per path.
 */
export class PopulateStep implements OperationStep {
  /** The step name in the pipeline. */
  readonly name = "populate";

  /**
   * Populates the result documents of the operation.
   *
   * @param ctx - The operation context whose result is populated.
   * @returns Nothing (synchronously) when there is nothing to populate, so the common path of every
   * operation creates no promise; otherwise a promise that settles when all paths are populated.
   */
  run(ctx: OperationContext): void | Promise<void> {
    const plans = OperationView.populate(ctx);
    if (plans.length === 0 || ctx.mode === "explain") return;
    const plan = ctx.plan as FindPlan | ModifyPlan;
    if ("mode" in plan && plan.mode.kind === "explain") return;
    const docs = PopulateStep.documents(ctx);
    if (docs.length === 0) return;
    const connection = ctx.locals.get(Documents.CONNECTION) as Connection | undefined;
    if (connection === undefined) return;
    return PopulateStep.populate(ctx, plan, plans, docs, connection);
  }

  /**
   * Builds the populate run and executes it.
   *
   * @param ctx - The operation context.
   * @param plan - The find or modify plan of the operation.
   * @param plans - The populate plans of the operation.
   * @param docs - The result documents to populate.
   * @param connection - The connection that owns the documents.
   */
  private static async populate(
    ctx: OperationContext,
    plan: FindPlan | ModifyPlan,
    plans: ReturnType<typeof OperationView.populate>,
    docs: readonly object[],
    connection: Connection,
  ): Promise<void> {
    const run: PopulateRun = {
      connection,
      session: ctx.session,
      /* One query at a time in a transaction, and in an explicit session of a write. */
      sequential: ctx.inTransaction || (ctx.session !== undefined && WRITE_OPERATIONS.has(ctx.op)),
      lean: plan.lean,
      parent: ctx,
      options: Object.freeze({
        ...(ctx.options.readPreference === undefined ? {} : { readPreference: ctx.options.readPreference }),
        ...(ctx.options.readConcern === undefined ? {} : { readConcern: ctx.options.readConcern }),
        ...(ctx.options.comment === undefined ? {} : { comment: ctx.options.comment }),
        ...(ctx.timeoutMS === undefined ? {} : { timeoutMS: ctx.timeoutMS }),
        /* The populated documents are read with the same check as the documents that hold them. */
        validateReads: PostProcessStep.validates(ctx),
      }),
    };
    await PopulateExecutor.populate(docs, ctx.target.schema, plans, run);
  }

  /**
   * The documents of the result (a list, one document, or the `value` of a find-and-modify with metadata).
   *
   * @param ctx - The operation context.
   * @returns The documents to populate; empty when the result holds none.
   */
  private static documents(ctx: OperationContext): readonly object[] {
    const result = ctx.result;
    if (Array.isArray(result)) return result.filter((doc): doc is object => typeof doc === "object" && doc !== null);
    if (result === null || typeof result !== "object") return [];
    const plan = ctx.plan as Partial<ModifyPlan>;
    if (plan.includeResultMetadata === true) {
      const value = (result as { readonly value?: unknown }).value;
      return typeof value === "object" && value !== null ? [value] : [];
    }
    return [result];
  }
}
