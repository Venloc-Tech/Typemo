import { HookErrors } from "../../../hooks/hook-errors.ts";
import { HookRegistry } from "../../../hooks/hook-registry.ts";
import { OperationHooks } from "../../../hooks/operation-hooks.ts";
import type { CompiledSchema } from "../../../schema/compiler/compiled-schema.ts";
import { DriverExecutor } from "../../executor/driver-executor.ts";
import type { OperationContext } from "../operation-context.ts";
import { type OperationStep, STEP_ORDER, type StepName } from "../operation-step.ts";

/**
 * The slots from `hooksPost` on: a failure there comes after the operation succeeded and its post
 * hooks ran (or had nothing to run), so it never runs `postError`.
 */
const FROM_POST: ReadonlySet<StepName> = new Set(STEP_ORDER.slice(STEP_ORDER.indexOf("hooksPost")));

/**
 * The `hooksPost` step: the `post` hooks with the result — for a cursor once per batch with that batch,
 * after hydration and populate (one order everywhere) — and the `postError` hooks with the error.
 *
 * Symmetry: every operation that has an event ends in EXACTLY ONE of
 * the two — `post` when it succeeded (also an empty `insertMany`/`bulkWrite`, a skipped one), `postError` when
 * any step before the post hooks failed: a cast or validation error, a pre hook, the preparation again after a pre
 * hook's `modify`, the driver (ordered or unordered bulk alike), the audit write, a cursor's fetch before its first
 * `post`.
 * A `post` hook that throws, or a step after the post hooks that fails (`instrumentEnd`): the operation had succeeded
 * and its post
 * hooks ran; no `postError` runs. The hook's error of a write outside a transaction reaches the caller as a
 * `PostHookError` (`applied: true`, the write's `result`, the hook's error in `cause`); otherwise as it was thrown. A cursor: once the post hooks ran for
 * a batch, a later failure
 * (`getMore`, a step of a later batch) runs no `postError` either — the error reaches the caller as it is.
 */
export class HooksPostStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "hooksPost";

  /**
   * Runs the `post` hooks of the operation's event with the result.
   *
   * @param ctx - The context of the operation.
   * @returns Nothing when no hook is registered, else a promise settled when the hooks are done.
   * @throws {TypemoError} When a hook fails.
   */
  run(ctx: OperationContext): void | Promise<void> {
    const event = ctx.hookEvent;
    /* No hook of the event: no promise, no tick. */
    if (event === undefined || HookRegistry.list(ctx.target.schema, event, "post").length === 0) return;
    return OperationHooks.run(ctx, "post", [ctx.result]).catch((error: unknown) => {
      /* The write is done: outside a transaction it stays, and the caller must know (PostHookError). */
      if (DriverExecutor.access(ctx) !== "write") throw error;
      throw HookErrors.afterWrite(ctx.target.entity.name, ctx.op, ctx.result, error, ctx.inTransaction);
    });
  }

  /**
   * Runs the `postError` hooks with the error, unless the operation already ended in `post`.
   *
   * @param ctx - The context of the operation; `ctx.error` holds the failure.
   * @returns Nothing when no hook applies, else a promise settled when the hooks are done.
   */
  onError(ctx: OperationContext): void | Promise<void> {
    const event = ctx.hookEvent;
    if (event === undefined || (ctx.failedStep !== undefined && FROM_POST.has(ctx.failedStep))) return;
    /* A cursor whose post hooks ran for an earlier batch: the operation already ended in `post` once. */
    if (ctx.postDone) return;
    if (HookRegistry.list(ctx.target.schema, event, "postError").length === 0) return;
    return OperationHooks.run(ctx, "postError", [ctx.error]);
  }

  /**
   * `run` is needed only for models with an operation `post` hook (`onError` runs on every step anyway).
   *
   * @param schema - The compiled schema of the model.
   * @returns `true` when the schema has an operation `post` hook.
   */
  needed(schema: CompiledSchema): boolean {
    return HookRegistry.hasOperationHooks(schema, "post");
  }
}
