import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../../bson/bson-guards.ts";
import type { PlanDocument } from "../../query/plan.ts";
import { SchemaWalker } from "../../schema/compiler/schema-walker.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import type { OperationStep } from "../pipeline/operation-step.ts";
import { AggregateStages } from "./aggregate-stages.ts";
import { FilterCodec } from "./filter-codec.ts";
import { OperationView, type WorkUnit } from "./operation-view.ts";
import { PipelineGuard } from "./pipeline-guard.ts";
import { UpdateCodec } from "./update-codec.ts";

/**
 * The `cast` step: every value by the strict casts (the native type plus the safe list), through the node of its
 * path. Pure: new frozen values, the input is never touched (Mongoose H127, H196, H211: the cast mutated user
 * filters and updates). The result stays in CODE names and hydrated form (Maps, `number` for int32): the validators
 * and their messages speak the user's names; the encode step at the end of `validate` turns everything into
 * database form.
 *
 * Filters: every operator by the type of its path (`$in`/`$nin`/`$all` elements, `$elemMatch` against the element,
 * `$size`, `$mod`, `$bits*`, `$type`, `$regex` for strings only, geo operands as numbers, Mongoose H026/H146).
 * Updates: every operator, positional paths and arrayFilters by the element of their `$[id]`. Documents and
 * replacements: `SchemaWalker.castDocument` (strict keys, discriminators). Aggregations: `$match` literals while
 * the documents are stored documents (Mongoose H14). `$expr` is compiled by the query layer and not cast. Update
 * pipelines: the constants written by `$set`/`$addFields` (`PipelineGuard`).
 */
export class CastStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "cast";

  /**
   * Casts the filters, updates, documents and aggregation `$match` literals of the operation.
   *
   * @param ctx - The context of the operation.
   * @throws {CastError} When a value cannot be cast strictly.
   */
  run(ctx: OperationContext): void {
    const schema = OperationView.schema(ctx);
    /* A document write: the values are the document's, cast when they were set; only the filter (`_id`, version,
       shard key) is cast here, because a user `set` must not run twice (Mongoose H508). */
    if (ctx.isDocument) {
      OperationView.map(ctx, (unit) =>
        unit.filter === undefined ? unit : { ...unit, filter: FilterCodec.cast(schema, unit.filter) },
      );
      return;
    }
    /* Inserts of a bulkWrite prepared by the document layer were cast when their values were set. */
    const prepared = ctx.document?.prepared;
    OperationView.map(ctx, (unit) => (prepared?.has(unit.index) === true ? unit : CastStep.unit(schema, unit)));
    if (ctx.op === "aggregate" && ctx.pipeline !== undefined) {
      ctx.pipeline = AggregateStages.cast(ctx.pipeline, schema, {
        schemaOfCollection: (collection) => OperationView.schemaOfCollection(ctx, collection),
      });
    }
  }

  /**
   * Casts one unit of work.
   *
   * @param schema - The compiled schema.
   * @param unit - The unit.
   * @returns The cast unit.
   * @throws {CastError} When a value cannot be cast strictly.
   */
  static unit(schema: Parameters<typeof FilterCodec.cast>[0], unit: WorkUnit): WorkUnit {
    let out: WorkUnit = unit;
    if (unit.filter !== undefined) out = { ...out, filter: FilterCodec.cast(schema, unit.filter) };
    /* An update pipeline: its constants are values like any other (see PipelineGuard). */
    if (Array.isArray(unit.update)) {
      out = { ...out, update: PipelineGuard.cast(schema, unit.update as readonly PipelineStage[]) };
    }
    if (unit.update !== undefined && !Array.isArray(unit.update)) {
      const update = unit.update as PlanDocument;
      out = { ...out, update: UpdateCodec.walk(schema, update, "cast") };
      if (unit.arrayFilters !== undefined) {
        out = {
          ...out,
          arrayFilters: UpdateCodec.arrayFilters(unit.arrayFilters, UpdateCodec.identifiers(schema, update), "cast"),
        };
      }
    }
    if (unit.replacement !== undefined) out = { ...out, replacement: CastStep.document(schema, unit.replacement) };
    if (unit.document !== undefined) out = { ...out, document: CastStep.document(schema, unit.document) };
    return out;
  }

  /**
   * Casts and freezes a whole document.
   *
   * @param schema - The compiled schema.
   * @param document - The document in code names.
   * @returns The cast, frozen document.
   */
  private static document(schema: Parameters<typeof FilterCodec.cast>[0], document: PlanDocument): PlanDocument {
    return CastStep.freeze(SchemaWalker.castDocument(schema, document)) as PlanDocument;
  }

  /**
   * Deep-freezes plain objects and arrays of a cast value (Maps and BSON values stay as they are).
   *
   * @param value - The cast value.
   * @returns `value`, frozen.
   */
  static freeze(value: unknown): unknown {
    if (Array.isArray(value)) {
      for (const item of value) CastStep.freeze(item);
      return Object.freeze(value);
    }
    if (BsonGuards.isPojo(value)) {
      for (const item of Object.values(value)) CastStep.freeze(item);
      return Object.freeze(value);
    }
    return value;
  }
}
