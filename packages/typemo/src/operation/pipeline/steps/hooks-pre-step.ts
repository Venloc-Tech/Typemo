import { HookRegistry } from "../../../hooks/hook-registry.ts";
import { OperationHooks } from "../../../hooks/operation-hooks.ts";
import type { CompiledSchema } from "../../../schema/compiler/compiled-schema.ts";
import type { OperationContext } from "../operation-context.ts";
import type { OperationStep } from "../operation-step.ts";

/**
 * The `hooksPre` step: the `pre` hooks of the operation's event, one after another (`this` =
 * `OperationHooks`: the operation's values in database form). A hook may `skip(result)` the operation: the
 * remaining pre hooks do not run and `execute` returns that result instead of calling the driver.
 */
export class HooksPreStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "hooksPre";

  /**
   * Runs the `pre` hooks of the operations inside a `bulkWrite` (each its standalone counterpart's), then those of
   * the operation's own event.
   *
   * @param ctx - The context of the operation.
   * @returns Nothing when no hook is registered, else a promise settled when the hooks are done.
   * @throws {TypemoError} When a hook fails.
   */
  run(ctx: OperationContext): void | Promise<void> {
    /* The operations inside a bulkWrite run their own (standalone) pre hooks first, in order. */
    const units = ctx.document?.units?.pre(ctx);
    if (units !== undefined) return units.then(() => this.#own(ctx));
    return this.#own(ctx);
  }

  /**
   * The `pre` hooks of the operation's own event.
   *
   * @param ctx - The context of the operation.
   * @returns Nothing when no hook is registered, else a promise settled when the hooks are done.
   */
  #own(ctx: OperationContext): void | Promise<void> {
    const event = ctx.hookEvent;
    /* No hook of the event: no promise, no tick. */
    if (event === undefined || HookRegistry.list(ctx.target.schema, event, "pre").length === 0) return;
    return OperationHooks.run(ctx, "pre", []);
  }

  /**
   * Only models with an operation `pre` hook need the step (the hook table is fixed when the schema is compiled).
   *
   * @param schema - The compiled schema of the model.
   * @returns `true` when the schema has an operation `pre` hook.
   */
  needed(schema: CompiledSchema): boolean {
    return HookRegistry.hasOperationHooks(schema, "pre");
  }
}
