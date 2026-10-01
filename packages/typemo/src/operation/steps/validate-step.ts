import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import { AuditPolicy } from "../../policies/audit-policy.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import type { OperationStep } from "../pipeline/operation-step.ts";
import { EncodeStep } from "./encode-step.ts";
import { type GuardedPath, IncrementGuard } from "./increment-guard.ts";
import { OperationView, type WorkUnit } from "./operation-view.ts";
import { type GuardedValue, PipelineGuard } from "./pipeline-guard.ts";
import { ReplacementGuard } from "./replacement-guard.ts";
import { UpdateValidator } from "./update-validator.ts";
import { UpsertCheck } from "./upsert-check.ts";
import { IssueCollector, ValueValidator } from "./value-validator.ts";

/* The update operations whose `$inc`/`$mul` on fields with min/max become conditional. */
const GUARDED_KINDS: ReadonlySet<string> = new Set(["updateOne", "updateMany", "findOneAndUpdate"]);

/**
 * The `validate` step: schema validators. Whole documents for inserts and replacements (`required` and every value
 * validator, defaults included), the written paths for operator updates (`UpdateValidator`). Every issue of a unit is
 * collected into ONE `ValidationError`. In an unordered `insertMany`/`bulkWrite` an invalid unit is rejected
 * (`ctx.reject`) and the others go on. Then the encode step turns the values into the database form `execute` expects.
 */
export class ValidateStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "validate";
  readonly #encode = new EncodeStep();

  /**
   * Validates the values and encodes them to the database form.
   *
   * @param ctx - The context of the operation.
   * @returns Nothing when there is nothing to validate, else a promise settled when validation is done.
   * @throws {ValidationError} When a value fails validation.
   */
  run(ctx: OperationContext): void | Promise<void> {
    /* A document write: the document validated its changes itself, so only encode. So does an operation with
       nothing to validate (reads, deletes, aggregations): no promise, no tick. */
    const prepared = ctx.document?.prepared;
    if (
      ctx.isDocument ||
      !OperationView.units(ctx).some((unit) => ValidateStep.validates(unit) && prepared?.has(unit.index) !== true)
    ) {
      AuditPolicy.capture(ctx);
      this.#encode.run(ctx);
      return;
    }
    return this.#validate(ctx);
  }

  /**
   * Tells whether the validators look at a unit: a whole document or an operator update.
   *
   * @param unit - The unit of work.
   * @returns `true` when the unit has to be validated.
   */
  private static validates(unit: WorkUnit): boolean {
    return unit.document !== undefined || unit.replacement !== undefined || unit.update !== undefined;
  }

  /* Validates every unit asynchronously, then audits and encodes. */
  async #validate(ctx: OperationContext): Promise<void> {
    const schema = OperationView.schema(ctx);
    const guards = new Map<number, readonly GuardedPath[]>();
    const computed = new Map<number, readonly GuardedValue[]>();
    /* Inserts of a bulkWrite prepared by the document layer were validated by the document (with its hooks). */
    const prepared = ctx.document?.prepared;
    await OperationView.mapAsync(ctx, async (unit) => {
      if (prepared?.has(unit.index) === true) return unit;
      const operation = ctx.op === "bulkWrite" || ctx.op === "insertMany" ? ctx.op : unit.kind;
      const whole = unit.document ?? unit.replacement;
      if (whole !== undefined) {
        const sink = new IssueCollector();
        ValueValidator.document(
          schema,
          whole,
          [],
          (path) => ({ kind: "document", operation, path: path.join(".") }),
          sink,
          unit.document === undefined,
        );
        await sink.finish();
      }
      /* An update pipeline: constants validated now, computed values guarded by the server (see PipelineGuard). */
      if (Array.isArray(unit.update)) {
        const values = await PipelineGuard.plan(schema, unit.update as readonly PipelineStage[], {
          operation,
          upsert: unit.upsert,
          filter: unit.filter,
        });
        if (values.length > 0) {
          if (unit.upsert)
            throw PipelineGuard.refuse(values, "with upsert (a failed guard would insert a new document)");
          if (ctx.op === "bulkWrite" || !GUARDED_KINDS.has(unit.kind)) {
            throw PipelineGuard.refuse(
              values,
              "in bulkWrite (no per-operation match count tells a failed guard from a missing document); use updateOne/updateMany",
            );
          }
          computed.set(unit.index, values);
        }
        if (unit.upsert) UpsertCheck.pipeline(schema, unit.filter, unit.update as readonly PipelineStage[]);
      }
      if (unit.update !== undefined && !Array.isArray(unit.update)) {
        await UpdateValidator.validate(schema, unit.update as PlanDocument, {
          operation,
          upsert: unit.upsert,
          filter: unit.filter,
        });
        /* The document an upsert would insert has every required field (see UpsertCheck). */
        if (unit.upsert) UpsertCheck.update(schema, unit.filter, unit.update as PlanDocument);
        /* `$inc`/`$mul` on fields with min/max become conditional (see IncrementGuard). */
        if (GUARDED_KINDS.has(unit.kind)) {
          const paths = IncrementGuard.paths(schema, unit.update as PlanDocument, ctx.op);
          if (paths.length > 0 && unit.upsert) throw IncrementGuard.refuseUpsert(paths);
          if (paths.length > 0) guards.set(unit.index, paths);
        }
      }
      return unit;
    });
    /* The audit entry records the cast values in code names (before the encode). */
    AuditPolicy.capture(ctx);
    this.#encode.run(ctx);
    IncrementGuard.apply(ctx, guards);
    PipelineGuard.apply(ctx, computed);
    /* A replacement must agree with the stored immutable fields (see ReplacementGuard). */
    ReplacementGuard.apply(ctx);
  }
}
