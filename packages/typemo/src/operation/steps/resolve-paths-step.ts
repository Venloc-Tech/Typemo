import { ImmutablePolicy } from "../../policies/immutable-policy.ts";
import { PolicyErrors } from "../../policies/policy-errors.ts";
import { StrictPathPolicy } from "../../policies/strict-path-policy.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import type { OperationStep } from "../pipeline/operation-step.ts";
import { OperationView } from "./operation-view.ts";
import { UpdateGuards } from "./update-guards.ts";

/**
 * The `resolvePaths` step: every path the operation names is resolved through the compiled schema; an unknown
 * path is a `StrictModeError` (`StrictPathPolicy`). The policies that need the resolved nodes run here too:
 * `ImmutablePolicy` (a write of an immutable path outside `$setOnInsert`), and the replacement rules: the server keeps
 * `_id` by itself, so a replacement that carries one is refused, and the core keeps the service fields, so a
 * replacement that carries one is refused too. Whether the other immutable fields agree with the stored document is
 * known only to the server (`ReplacementGuard`). A positional `$` of an update needs a condition on its array in
 * the filter (`UpdateGuards`).
 */
export class ResolvePathsStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "resolvePaths";
  readonly #strict = new StrictPathPolicy();
  readonly #immutable = new ImmutablePolicy();

  /**
   * Resolves every named path and applies the immutable and replacement rules.
   *
   * @param ctx - The context of the operation.
   * @throws {StrictModeError} For an unknown path or an immutable-field violation.
   */
  run(ctx: OperationContext): void {
    this.#strict.run(ctx);
    this.#immutable.run(ctx);
    const schema = OperationView.schema(ctx);
    for (const unit of OperationView.units(ctx)) {
      if (unit.replacement !== undefined) {
        UpdateGuards.replacementId(schema.name, unit.replacement);
        ResolvePathsStep.replacement(schema, unit.replacement);
      }
      if (unit.update !== undefined) UpdateGuards.positional(unit.filter, unit.update);
    }
  }

  /**
   * The service fields (`createdAt`, `updatedAt`, `__v`) are the core's: a replacement must NOT carry them,
   * since the executor keeps `createdAt`/`__v` and bumps `updatedAt` atomically. The other immutable fields are
   * compared with the stored document by the server (`ReplacementGuard`).
   *
   * @param schema - The compiled schema.
   * @param replacement - The replacement document.
   * @throws {StrictModeError} When the replacement carries a service field.
   */
  static replacement(schema: CompiledSchema, replacement: PlanDocument): void {
    for (const field of schema.fields) {
      const service = field.service === "createdAt" || field.service === "updatedAt" || field.service === "version";
      if (service && Object.hasOwn(replacement, field.key)) {
        throw PolicyErrors.strict(
          "immutable",
          `a replacement of ${schema.name} carries the service field "${field.key}": the core keeps createdAt/__v and bumps updatedAt itself; leave it out`,
          field.key,
        );
      }
    }
  }
}
