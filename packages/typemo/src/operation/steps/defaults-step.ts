import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import type { OperationStep } from "../pipeline/operation-step.ts";
import { DefaultsFiller } from "./defaults-filler.ts";
import { OperationView } from "./operation-view.ts";

/**
 * The `defaults` step: defaults, timestamps and the version key (see `DefaultsFiller`). One clock per operation
 * (`OperationView.now`): `createdAt` and `updatedAt` of one insert are equal, every document of an `insertMany`
 * has the same time.
 */
export class DefaultsStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "defaults";

  /**
   * Fills defaults, timestamps and the version key in every unit of the operation.
   *
   * @param ctx - The context of the operation.
   */
  run(ctx: OperationContext): void {
    const schema = OperationView.schema(ctx);
    const clock = { now: OperationView.now(ctx) };
    OperationView.map(ctx, (unit) => {
      let out = unit;
      if (unit.document !== undefined)
        out = { ...out, document: DefaultsFiller.document(schema, unit.document, clock) };
      if (unit.replacement !== undefined) {
        out = { ...out, replacement: DefaultsFiller.document(schema, unit.replacement, clock, true) };
      }
      if (unit.update !== undefined) {
        out = {
          ...out,
          update: Array.isArray(unit.update)
            ? DefaultsFiller.pipeline(schema, unit.update as readonly PipelineStage[], unit.upsert, clock)
            : DefaultsFiller.update(schema, unit.update as PlanDocument, unit.filter, unit.upsert, clock),
        };
      }
      return out;
    });
  }
}
