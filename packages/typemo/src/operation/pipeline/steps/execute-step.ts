import { HookSkip } from "../../../hooks/hook-skip.ts";
import { AuditPolicy } from "../../../policies/audit-policy.ts";
import { DriverExecutor } from "../../executor/driver-executor.ts";
import type { OperationContext } from "../operation-context.ts";
import type { OperationStep } from "../operation-step.ts";

/**
 * The `execute` step: the driver call (`DriverExecutor`, the only one) or, when a pre hook skipped the
 * operation, its result (`HookSkip`). A bulk that failed after writing part of its documents has that part
 * audited here (the audit policy), before the error travels to the post-error hooks.
 */
export class ExecuteStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "execute";

  /**
   * Calls the driver, or takes the result a pre hook skipped with.
   *
   * @param ctx - The context of the operation; its `result` is set.
   * @returns A promise settled when the result is set.
   * @throws {TypemoError} The classified driver error.
   */
  async run(ctx: OperationContext): Promise<void> {
    if (ctx.skipped !== undefined) {
      ctx.result = HookSkip.raw(ctx, ctx.skipped.result);
      return;
    }
    try {
      ctx.result = await DriverExecutor.execute(ctx);
    } catch (error) {
      await AuditPolicy.afterFailure(ctx, error);
      throw error;
    }
  }
}
