import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../../bson/bson-guards.ts";
import { SafeRecord } from "../../internal/safe-record.ts";
import type { PlanDocument, SortPair } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import { SchemaWalker } from "../../schema/compiler/schema-walker.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import { AggregateStages } from "./aggregate-stages.ts";
import { FilterCodec } from "./filter-codec.ts";
import { OperationView, type WorkUnit } from "./operation-view.ts";
import { PathResolver } from "./path-resolver.ts";
import type { ResultShape } from "./result-shape.ts";
import { UpdateCodec } from "./update-codec.ts";

/* `ctx.locals` key of the translated `distinct` path. */
const DISTINCT_FIELD = Symbol("typemo.steps.distinctField");

/**
 * Code form to database form: the last transformation before the driver, which expects the DATABASE form. Code paths
 * become database names (Mongoose H14: filter, update, arrayFilters, projection, sort, the `distinct` field,
 * aggregation stages while the documents are stored documents) and hydrated values become the wire form
 * (`Int32`/`Double` wrappers, Maps as plain objects, subdocuments by their schema). It runs at the end of the
 * `validate` slot; the result rows go back to code names with `DbNames.toCode` and the shape left in `ctx.locals`
 * (`OperationView.RESULT_SHAPE`).
 */
export class EncodeStep {
  /** The name of the step. */
  readonly name = "encode";
  /** `ctx.locals` key of the translated `distinct` path (the context has no working `field`). */
  static readonly DISTINCT_FIELD: symbol = DISTINCT_FIELD;

  /**
   * Encodes every value of the operation to the database form and stores the result shape.
   *
   * @param ctx - The context of the operation.
   */
  run(ctx: OperationContext): void {
    const schema = OperationView.schema(ctx);
    OperationView.map(ctx, (unit) => EncodeStep.unit(schema, unit, ctx));
    if (ctx.projection !== undefined) ctx.projection = EncodeStep.projection(schema, ctx.projection);
    if (ctx.sort !== undefined) ctx.sort = EncodeStep.sort(schema, ctx.sort);
    const field = OperationView.planField(ctx, "field");
    if (typeof field === "string") ctx.locals.set(DISTINCT_FIELD, EncodeStep.path(schema, field));
    const pipeline = OperationView.pipeline(ctx);
    if (pipeline !== undefined && ctx.op === "aggregate") {
      const encoded = AggregateStages.encode(pipeline, schema, {
        schemaOfCollection: (collection) => OperationView.schemaOfCollection(ctx, collection),
      });
      ctx.pipeline = encoded.stages;
      ctx.locals.set(OperationView.RESULT_SHAPE, encoded.shape);
    } else {
      const shape: ResultShape = { schema, fields: new Map() };
      ctx.locals.set(OperationView.RESULT_SHAPE, shape);
    }
  }

  /**
   * One unit in database form.
   *
   * @param schema - The compiled schema.
   * @param unit - The unit of work.
   * @param ctx - The context, needed to resolve the schemas of joined collections.
   * @returns The encoded unit.
   */
  static unit(schema: CompiledSchema, unit: WorkUnit, ctx?: OperationContext): WorkUnit {
    let out = unit;
    if (unit.filter !== undefined) out = { ...out, filter: FilterCodec.encode(schema, unit.filter) };
    if (unit.update !== undefined) {
      if (Array.isArray(unit.update)) {
        const stages = unit.update as readonly PipelineStage[];
        out = {
          ...out,
          update: AggregateStages.encode(stages, schema, {
            schemaOfCollection: (collection) =>
              ctx === undefined ? undefined : OperationView.schemaOfCollection(ctx, collection),
            document: true,
          }).stages,
        };
      } else {
        const update = unit.update as PlanDocument;
        out = { ...out, update: UpdateCodec.walk(schema, update, "encode") };
        if (unit.arrayFilters !== undefined) {
          out = {
            ...out,
            arrayFilters: UpdateCodec.arrayFilters(
              unit.arrayFilters,
              UpdateCodec.identifiers(schema, update),
              "encode",
            ),
          };
        }
      }
    }
    if (unit.replacement !== undefined) out = { ...out, replacement: EncodeStep.document(schema, unit.replacement) };
    if (unit.document !== undefined) out = { ...out, document: EncodeStep.document(schema, unit.document) };
    return out;
  }

  /**
   * A cast document in database form.
   *
   * @param schema - The compiled schema.
   * @param document - The cast document.
   * @returns The frozen encoded document.
   */
  static document(schema: CompiledSchema, document: PlanDocument): PlanDocument {
    return Object.freeze(SchemaWalker.encodeDocument(schema, document));
  }

  /**
   * A code path in database names (positional segments and Map keys kept).
   *
   * @param schema - The compiled schema.
   * @param path - The path in code names.
   * @returns The path in database names.
   */
  static path(schema: CompiledSchema, path: string): string {
    const resolution = PathResolver.resolve(schema, path, "read");
    return resolution.ok ? resolution.value.dbPath : path;
  }

  /**
   * A projection in database names; `$elemMatch` operands encoded against the element.
   *
   * @param schema - The compiled schema.
   * @param projection - The projection in code names.
   * @returns The projection in database names.
   */
  static projection(schema: CompiledSchema, projection: PlanDocument): PlanDocument {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(projection)) {
      const resolution = PathResolver.resolve(schema, key, "read");
      if (!resolution.ok) {
        SafeRecord.set(out, key, value);
        continue;
      }
      const node = resolution.value.node;
      const encoded =
        BsonGuards.isPlainObject(value) && BsonGuards.isPlainObject(value.$elemMatch) && node.kind === "array"
          ? Object.freeze({ ...value, $elemMatch: FilterCodec.walk(value.$elemMatch, node.element, "encode") })
          : value;
      SafeRecord.set(out, resolution.value.dbPath, encoded);
    }
    return Object.freeze(out);
  }

  /**
   * Sort pairs in database names (`$meta` keys name result fields and are kept).
   *
   * @param schema - The compiled schema.
   * @param sort - The sort pairs in code names.
   * @returns The sort pairs in database names.
   */
  static sort(schema: CompiledSchema, sort: readonly SortPair[]): readonly SortPair[] {
    return Object.freeze(
      sort.map(([path, direction]) =>
        Object.freeze([typeof direction === "object" ? path : EncodeStep.path(schema, path), direction] as const),
      ),
    );
  }
}
