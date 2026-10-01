import type { TransactionScope } from "../../../connection/transaction-scope.ts";
import { StrictModeError } from "../../../errors/strict-mode-error.ts";
import { OperationView } from "../../steps/operation-view.ts";
import type { OperationContext } from "../operation-context.ts";
import type { OperationStep } from "../operation-step.ts";
import { AMBIENT_TRANSACTION } from "./resolve-context-step.ts";

/**
 * The `validateOptions` step: options that conflict are errors, not silently ignored. Inside a
 * transaction the transaction's read/write concern and read preference apply — the server refuses a
 * per-operation one (the driver drops them silently) — and an operation must not override the transaction's `timeoutMS`
 * (driver
 * rule). Unknown options cannot exist: the builders' types have none.
 */
export class ValidateOptionsStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "validateOptions";

  /**
   * Rejects per-operation options that a transaction forbids.
   *
   * @param ctx - The context of the operation.
   * @throws {StrictModeError} When the operation overrides a setting of its transaction.
   */
  run(ctx: OperationContext): void {
    const scope = ctx.locals.get(AMBIENT_TRANSACTION) as TransactionScope | undefined;
    if (!ctx.inTransaction && scope === undefined) return;
    const where = OperationView.where(ctx);
    /**
     * Throws the transaction-option error for one offending option.
     *
     * @param what - Describes the offending option.
     * @throws {StrictModeError} Always.
     */
    const refuse = (what: string): never => {
      throw new StrictModeError(
        "transaction-option",
        `${where}: ${what} inside a transaction — the transaction's own settings apply (set them on transaction())`,
      );
    };
    if (ctx.options.readConcern !== undefined) refuse(`readConcern "${ctx.options.readConcern}"`);
    if (ctx.options.writeConcern !== undefined) refuse("a writeConcern");
    if (ctx.options.readPreference !== undefined && ctx.options.readPreference !== "primary") {
      refuse(`readPreference "${ctx.options.readPreference}" (a transaction reads from the primary)`);
    }
    if (ctx.timeoutMS !== undefined && scope?.timeoutMS !== undefined) {
      refuse(`timeoutMS ${ctx.timeoutMS} (the transaction has timeoutMS ${scope.timeoutMS})`);
    }
  }
}
