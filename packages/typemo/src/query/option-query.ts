import type { ClientSession, CollationOptions } from "mongodb";
import { PolicyContext, type PolicyValues } from "../policies/policy-context.ts";
import { ExecutableQuery } from "./executable-query.ts";
import type { OperationPlan, PlanOptions } from "./plan.ts";
import { QuerySpecs } from "./query-specs.ts";

/*
 * The options every non-find query takes (`WriteBuilder`, `ValueQuery`). Immutable: each call returns
 * a new query of the same class over a new plan.
 */

/**
 * A thenable plan with the common driver options.
 *
 * @typeParam R - What the query resolves to.
 * @example
 * const total = await User.countDocuments().hint("age_1").comment("dashboard").timeoutMS(500);
 */
export class OptionQuery<R> extends ExecutableQuery<R> {
  /**
   * The same query over another plan (same class, same executor).
   *
   * @param plan - The new plan; it is frozen.
   * @returns A new query over `plan`.
   */
  protected rebuild(plan: OperationPlan): this {
    const Same = this.constructor as new (...args: ConstructorParameters<typeof ExecutableQuery<R>>) => this;
    return new Same(this.executor, Object.freeze(plan) as OperationPlan, this.map);
  }

  /**
   * The same query with `options` merged over the current plan options.
   *
   * @param options - The options to set.
   * @returns A new query.
   */
  protected withOptions(options: Partial<PlanOptions>): this {
    return this.rebuild({
      ...this.plan,
      options: Object.freeze({ ...this.plan.options, ...options }),
    } as OperationPlan);
  }

  /**
   * Runs in this session (a transaction); `null` runs outside the ambient transaction.
   *
   * @param session - The session, or `null` to leave the ambient transaction.
   * @returns A new query bound to the session.
   */
  session(session: ClientSession | null): this {
    return this.withOptions({ session });
  }

  /**
   * The policy context of this operation (tenant, actor, soft delete view), over the ambient one taken
   * when the operation was built (`PolicyContext.run`).
   *
   * @param values - The policy values to set.
   * @returns A new query with the merged policy context.
   * @throws {PolicyError} When the values conflict with the ambient context.
   */
  policy(values: PolicyValues): this {
    return this.withOptions({
      policy: PolicyContext.merge(this.plan.options.policy, values, `${this.plan.op}.policy`),
    });
  }

  /**
   * Forces an index (name or key pattern).
   *
   * @param hint - The index name or key pattern.
   * @returns A new query with the hint.
   * @throws {QueryError} When `hint` is neither a name nor a non-empty key pattern.
   */
  hint(hint: string | Readonly<Record<string, 1 | -1 | "text" | "2dsphere" | "2d" | "hashed">>): this {
    return this.withOptions({ hint: QuerySpecs.hint(hint) });
  }

  /**
   * String comparison rules.
   *
   * @param collation - The collation options.
   * @returns A new query with a copy of the collation.
   */
  collation(collation: CollationOptions): this {
    return this.withOptions({ collation: Object.freeze({ ...collation }) });
  }

  /**
   * A comment for the profiler and the logs.
   *
   * @param comment - The comment text.
   * @returns A new query with the comment.
   */
  comment(comment: string): this {
    return this.withOptions({ comment });
  }

  /**
   * Client-side operation timeout (driver CSOT).
   *
   * @param ms - The timeout in milliseconds; `0` means no timeout.
   * @returns A new query with the timeout.
   * @throws {QueryError} When `ms` is not a non-negative integer.
   */
  timeoutMS(ms: number): this {
    return this.withOptions({ timeoutMS: QuerySpecs.timeoutMS(ms) });
  }
}
