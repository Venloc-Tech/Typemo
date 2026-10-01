import { TransactionContext } from "../../../connection/transaction-context.ts";
import { ConfigurationError } from "../../../errors/configuration-error.ts";
import { PolicyContext } from "../../../policies/policy-context.ts";
import { OperationView } from "../../steps/operation-view.ts";
import type { OperationContext, ResolvedOptions } from "../operation-context.ts";
import type { OperationStep } from "../operation-step.ts";

/** `ctx.locals` key: the ambient transaction the operation joined. */
export const AMBIENT_TRANSACTION = Symbol("ambientTransaction");

/**
 * The `resolveContext` step: the session (explicit, `null` = none, else the ambient transaction's — ALS, Mongoose
 * H349), `timeoutMS`, the policy context, the driver options; then waits for the connection (an operation issued
 * before `connect()` waits here, bounded by its `timeoutMS` or the client's `readyTimeoutMS`).
 */
export class ResolveContextStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "resolveContext";

  /**
   * The policy context: the plan's (captured when it was built, plus `.policy()`); a sub-operation without
   * one (populate) inherits its parent's — without the soft delete view, which is about the parent's own
   * documents (joined documents never show deleted ones); a plan built by the core without either takes the
   * ambient scope.
   *
   * @param ctx - The context of the operation.
   * @returns The frozen policy values the operation runs with.
   */
  static policy(ctx: OperationContext) {
    const own = ctx.plan.options.policy;
    if (own !== undefined) return own;
    const parent = ctx.parent?.policy;
    if (parent !== undefined) {
      const { includeDeleted: _include, onlyDeleted: _only, hardDelete: _hard, ...rest } = parent;
      return Object.freeze(rest);
    }
    return PolicyContext.current() ?? PolicyContext.EMPTY;
  }

  /**
   * Resolves the session, timeout, policy context and options, then waits for the connection.
   *
   * @param ctx - The context of the operation.
   * @returns `undefined` when the client is connected, else a promise settled when it is ready.
   * @throws {ConfigurationError} When the operation would join a transaction of another client.
   */
  run(ctx: OperationContext): Promise<void> | undefined {
    const options = ctx.plan.options;
    const ambient = TransactionContext.current();
    if (options.session === null) {
      ctx.session = undefined;
    } else if (options.session !== undefined) {
      ctx.session = options.session;
    } else if (ambient !== undefined) {
      if (ambient.owner !== ctx.environment.owner) {
        throw new ConfigurationError(
          `${OperationView.where(ctx)}: called inside a transaction of another client; its model cannot join that transaction — pass session(null) (or { session: null }) to run it outside explicitly`,
        );
      }
      ctx.session = ambient.session;
      ctx.locals.set(AMBIENT_TRANSACTION, ambient);
    }
    ctx.timeoutMS = options.timeoutMS;
    ctx.policy = ResolveContextStep.policy(ctx);
    /* One object, keys only when set: no spread per option. */
    const resolved: { -readonly [K in keyof ResolvedOptions]: ResolvedOptions[K] } = {};
    if (options.readPreference !== undefined) resolved.readPreference = options.readPreference;
    if (options.readConcern !== undefined) resolved.readConcern = options.readConcern;
    if (options.writeConcern !== undefined) resolved.writeConcern = options.writeConcern;
    if (options.hint !== undefined) resolved.hint = options.hint;
    if (options.collation !== undefined) resolved.collation = options.collation;
    if (options.comment !== undefined) resolved.comment = options.comment;
    if (options.batchSize !== undefined) resolved.batchSize = options.batchSize;
    if (options.allowDiskUse !== undefined) resolved.allowDiskUse = options.allowDiskUse;
    ctx.options = Object.freeze(resolved);
    /* A connected client gives no promise to wait for, so the step stays synchronous. */
    return ctx.environment.ready(ctx.timeoutMS);
  }
}
