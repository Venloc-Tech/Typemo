import { EmptyUpdatePolicy } from "../../policies/empty-update-policy.ts";
import { HiddenPolicy } from "../../policies/hidden-policy.ts";
import { SoftDeletePolicy } from "../../policies/soft-delete-policy.ts";
import { StageNames } from "../../policies/stage-names.ts";
import { TenantPolicy } from "../../policies/tenant-policy.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import type { OperationStep } from "../pipeline/operation-step.ts";

/**
 * The application policies a schema has. Which of them a model has is fixed when its schema is compiled, so it is
 * decided once per schema.
 *
 * @example
 * ```ts
 * const { hidden, tenant, softDelete } = PolicyStep.facts(schema);
 * ```
 */
interface PolicyFacts {
  /** The schema has hidden fields. */
  readonly hidden: boolean;
  /** The schema has a tenant field. */
  readonly tenant: boolean;
  /** The schema has a soft-delete field. */
  readonly softDelete: boolean;
}

/* The facts per schema, computed on the schema's first operation. */
const FACTS = new WeakMap<CompiledSchema, PolicyFacts>();

/**
 * The `policies` step: the policies that judge CAST values. The raw-input guards run in `normalize`, the path
 * policies in `resolvePaths` (they need no cast and must precede it); what remains here: `EmptyUpdatePolicy` after
 * the cast and `HiddenPolicy` (Mongoose H17: `$unset` of hidden fields in aggregations), then the application
 * policies (each off unless the schema enables it): tenant and soft delete. They run after Hidden and put their
 * `$match` stages BEFORE its `$unset` (at the start of a pipeline or sub-pipeline), so a hidden tenant or
 * delete-date field is still matched.
 *
 * A policy the model does not have is skipped; for an aggregation only when the pipeline also joins nothing
 * (`StageNames.hasJoins`, one scan shared by the three), because a joined model's tenant, soft delete and hidden
 * fields apply whatever the aggregated model has. Skipping is exact: the policy would have left the operation as it is.
 */
export class PolicyStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "policies";
  readonly #emptyUpdate = new EmptyUpdatePolicy();
  readonly #hidden = new HiddenPolicy();
  readonly #tenant = new TenantPolicy();
  readonly #softDelete = new SoftDeletePolicy();

  /**
   * Applies the empty-update, hidden, tenant and soft-delete policies the schema needs.
   *
   * @param ctx - The context of the operation.
   * @throws {TypemoError} When a policy rejects the operation.
   */
  run(ctx: OperationContext): void {
    this.#emptyUpdate.run(ctx);
    const facts = PolicyStep.facts(ctx.target.schema);
    const aggregate = ctx.op === "aggregate" && ctx.pipeline !== undefined;
    const joins = aggregate && StageNames.hasJoins(ctx.pipeline as NonNullable<typeof ctx.pipeline>);
    /* Hidden works on aggregations only. */
    if (aggregate && (joins || facts.hidden)) this.#hidden.run(ctx);
    if (joins || facts.tenant) this.#tenant.run(ctx);
    if (joins || facts.softDelete) this.#softDelete.run(ctx);
  }

  /**
   * What the schema has, computed on its first operation.
   *
   * @param schema - The compiled schema.
   * @returns The cached facts.
   */
  static facts(schema: CompiledSchema): PolicyFacts {
    const cached = FACTS.get(schema);
    if (cached !== undefined) return cached;
    const facts: PolicyFacts = Object.freeze({
      hidden: HiddenPolicy.hiddenPaths(schema).length > 0,
      tenant: TenantPolicy.fieldOf(schema) !== undefined,
      softDelete: SoftDeletePolicy.fieldOf(schema) !== undefined,
    });
    FACTS.set(schema, facts);
    return facts;
  }
}
