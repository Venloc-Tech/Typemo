import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import { PipelineSources } from "../../aggregate/pipeline/pipeline-source.ts";
import { TypemoError } from "../../errors/typemo-error.ts";
import type { PlanDocument, PlanOptions, PopulatePlan } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { BulkWriteModel } from "../pipeline/execution-plan.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";

/*
 * The value steps see an operation as a list of WORK UNITS: one filter/update/replacement/document with
 * the operation it belongs to. A single-document operation is one unit; `insertMany` is one unit per
 * document and `bulkWrite` one per operation, so every write goes through the SAME code whatever the
 * entry point (Mongoose had one cast path for queries and another for bulkWrite).
 */

/**
 * The kind of one unit of work.
 *
 * @example
 * const kind: UnitKind = "updateOne";
 */
export type UnitKind =
  | "find"
  | "findOne"
  | "countDocuments"
  | "estimatedDocumentCount"
  | "distinct"
  | "updateOne"
  | "updateMany"
  | "replaceOne"
  | "deleteOne"
  | "deleteMany"
  | "findOneAndUpdate"
  | "findOneAndReplace"
  | "findOneAndDelete"
  | "insertOne"
  | "aggregate"
  | "watch";

/**
 * One filter/update/replacement/document of an operation.
 *
 * @example
 * const unit: WorkUnit = {
 *   kind: "updateOne", index: 0, filter: { _id: id }, update: { $set: { a: 1 } }, upsert: false,
 * };
 */
export interface WorkUnit {
  /** What the unit does. */
  readonly kind: UnitKind;
  /** The index in the user's input (`insertMany` documents, `bulkWrite` operations), `0` otherwise. */
  readonly index: number;
  /** The filter, when the unit has one. */
  readonly filter?: PlanDocument;
  /** The update document or pipeline, when the unit updates. */
  readonly update?: PlanDocument | readonly PlanDocument[];
  /** The replacement document, when the unit replaces. */
  readonly replacement?: PlanDocument;
  /** The document to insert, when the unit inserts. */
  readonly document?: PlanDocument;
  /** The filters of `$[id]` positional updates. */
  readonly arrayFilters?: readonly PlanDocument[];
  /** Whether the unit inserts when nothing matches. */
  readonly upsert: boolean;
  /** `bulkWrite`: the index hint of the operation (passed through). */
  readonly hint?: string | PlanDocument;
}

/** The `ctx.locals` key of the operation's clock. */
const CLOCK = Symbol("typemo.steps.clock");
/** The `ctx.locals` key of an aggregation's result shape. */
const RESULT_SHAPE = Symbol("typemo.steps.resultShape");

/**
 * A plan seen as a bag of optional fields, for the ones that exist on some plan kinds only.
 *
 * @example
 * const loose: Loose = { upsert: true };
 */
type Loose = Partial<Record<string, unknown>>;
/**
 * `T` with its `readonly` modifiers removed.
 *
 * @typeParam T - The object type.
 * @example
 * type A = Mutable<{ readonly a: 1 }>; // { a: 1 }
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * A copy of `unit` with `key` set, or `unit` itself when `value` is `undefined`.
 *
 * @param unit - The unit.
 * @param key - The key to set.
 * @param value - The value.
 * @returns The unit with the key set.
 */
const set = <K extends keyof WorkUnit>(unit: WorkUnit, key: K, value: WorkUnit[K] | undefined): WorkUnit =>
  value === undefined ? unit : { ...unit, [key]: value };

/**
 * Reads and writes the work units of an operation context.
 *
 * @example
 * OperationView.map(ctx, (unit) => ({ ...unit, filter: encode(unit.filter) }));
 */
export class OperationView {
  /** The key of `ctx.locals` holding the result shape of an aggregation (Mongoose H14, for `postProcess`). */
  static readonly RESULT_SHAPE: symbol = RESULT_SHAPE;

  /** `ctx.locals` key: the populated path of a populate sub-query (instrumentation). */
  static readonly POPULATE_PATH: symbol = Symbol("typemo.operation.populatePath");

  /**
   * The compiled schema of the operation's model.
   *
   * @param ctx - The operation context.
   * @returns The schema.
   */
  static schema(ctx: OperationContext): CompiledSchema {
    return ctx.target.schema;
  }

  /**
   * The method the user called: the plan's `method` (`create`, `findById`, `aggregate`, …) when it differs from
   * the operation, otherwise the operation. Error texts name this, never an internal operation.
   *
   * @param ctx - The operation context.
   * @returns The method name.
   */
  static called(ctx: OperationContext): string {
    return (ctx.plan.options as PlanOptions | undefined)?.method ?? ctx.op;
  }

  /**
   * `Model.method` of the call, the prefix of error texts.
   *
   * @param ctx - The operation context.
   * @returns The prefix (`Account.create`).
   */
  static where(ctx: OperationContext): string {
    return `${ctx.target.entity.name}.${OperationView.called(ctx)}`;
  }

  /**
   * One clock per operation: every timestamp written by it has the same value.
   *
   * @param ctx - The operation context.
   * @returns The operation's clock, created on first use.
   */
  static now(ctx: OperationContext): Date {
    const existing = ctx.locals.get(CLOCK);
    if (existing instanceof Date) return existing;
    const now = new Date();
    ctx.locals.set(CLOCK, now);
    return now;
  }

  /**
   * The schema of another collection an aggregation names (`$lookup.from`, `$unionWith`, `$graphLookup.from`,
   * `$out`, `$merge.into`). An entity named in the stage gives its own schema (its policies apply whether or not
   * a model of it was created); a collection named by a string gives the schema of the connection's model of that
   * collection, `undefined` when there is none.
   *
   * @param ctx - The operation context.
   * @param collection - The collection name.
   * @returns The schema, or `undefined`.
   * @throws {ConfigurationError} When two different entities name the collection in one aggregation.
   */
  static schemaOfCollection(ctx: OperationContext, collection: string): CompiledSchema | undefined {
    if (ctx.pipeline !== undefined) {
      const named = PipelineSources.namedSchemas(ctx.pipeline).get(collection);
      if (named !== undefined) return named;
    }
    const planned = OperationView.planField(ctx, "pipeline");
    if (Array.isArray(planned) && planned !== ctx.pipeline) {
      const named = PipelineSources.namedSchemas(planned).get(collection);
      if (named !== undefined) return named;
    }
    return ctx.environment.schemaOfCollection(collection);
  }

  /**
   * A plan field that exists on some plan kinds only (`upsert`, `limit`, `populate`, …).
   *
   * @param ctx - The operation context.
   * @param key - The field name.
   * @returns The value, or `undefined` when the plan has no such field.
   */
  static planField(ctx: OperationContext, key: string): unknown {
    return (ctx.plan as unknown as Loose)[key];
  }

  /**
   * `true` for an unordered `insertMany`/`bulkWrite`: a failing unit is rejected, the others go on.
   *
   * @param ctx - The operation context.
   * @returns Whether the operation is unordered.
   */
  static unordered(ctx: OperationContext): boolean {
    return (ctx.op === "insertMany" || ctx.op === "bulkWrite") && OperationView.planField(ctx, "ordered") === false;
  }

  /**
   * `ctx.locals` key of an INTERNAL aggregation of populate: its rows are returned as stored
   * (database names), because populate hydrates the joined documents itself.
   */
  static readonly RAW_ROWS: symbol = Symbol("typemo.operation.rawRows");

  /**
   * The populate instructions of the plan (their `match` filters are sanitized like every filter).
   *
   * @param ctx - The operation context.
   * @returns The instructions; empty when the plan has none.
   */
  static populate(ctx: OperationContext): readonly PopulatePlan[] {
    const value = OperationView.planField(ctx, "populate");
    return Array.isArray(value) ? (value as PopulatePlan[]) : [];
  }

  /**
   * The stages of an aggregation or a change stream.
   *
   * @param ctx - The operation context.
   * @returns The stages, or `undefined` for other operations.
   */
  static pipeline(ctx: OperationContext): readonly PipelineStage[] | undefined {
    return ctx.op === "aggregate" || ctx.op === "watch" ? ctx.pipeline : undefined;
  }

  /**
   * The work units of the context, in input order.
   *
   * @param ctx - The operation context.
   * @returns One unit for a single-document operation, one per document for `insertMany`, one per operation for
   * `bulkWrite`.
   */
  static units(ctx: OperationContext): readonly WorkUnit[] {
    const upsert = OperationView.planField(ctx, "upsert") === true;
    switch (ctx.op) {
      case "insertOne":
      case "insertMany":
        return (ctx.documents ?? []).map((document, index) => ({ kind: "insertOne", index, document, upsert: false }));
      case "bulkWrite":
        return (ctx.operations ?? []).map((operation, index) => OperationView.bulkUnit(operation, index));
      case "aggregate":
      case "watch":
        return [{ kind: ctx.op, index: 0, upsert: false }];
      default: {
        /* One object, keys only when present: every step reads the units, so no copy per key. */
        const unit: Mutable<WorkUnit> = { kind: ctx.op, index: 0, upsert };
        if (ctx.filter !== undefined) unit.filter = ctx.filter;
        if (ctx.update !== undefined) unit.update = ctx.update;
        if (ctx.replacement !== undefined) unit.replacement = ctx.replacement;
        if (ctx.arrayFilters !== undefined) unit.arrayFilters = ctx.arrayFilters;
        return [unit];
      }
    }
  }

  /**
   * Writes the units back into the context (the context owns its fields; the units are new values).
   *
   * @param ctx - The operation context.
   * @param units - The units, in input order.
   */
  static apply(ctx: OperationContext, units: readonly WorkUnit[]): void {
    switch (ctx.op) {
      case "insertOne":
      case "insertMany":
        ctx.documents = Object.freeze(units.map((unit) => unit.document as PlanDocument));
        return;
      case "bulkWrite":
        ctx.operations = Object.freeze(units.map((unit) => OperationView.bulkModel(unit)));
        return;
      case "aggregate":
      case "watch":
        return;
      default: {
        const [unit] = units;
        if (unit === undefined) return;
        if (unit.filter !== undefined) ctx.filter = unit.filter;
        if (unit.update !== undefined) ctx.update = unit.update;
        if (unit.replacement !== undefined) ctx.replacement = unit.replacement;
        if (unit.arrayFilters !== undefined) ctx.arrayFilters = unit.arrayFilters;
      }
    }
  }

  /**
   * Maps every unit through `transform`. In an unordered `insertMany`/`bulkWrite` a unit that throws a
   * Typemo error is rejected (`ctx.reject`) and kept as it was; units rejected earlier are skipped.
   *
   * @param ctx - The operation context.
   * @param transform - Turns one unit into its new value.
   * @throws {TypemoError} What `transform` throws, in an ordered operation; any other error in every case.
   */
  static map(ctx: OperationContext, transform: (unit: WorkUnit) => WorkUnit): void {
    const unordered = OperationView.unordered(ctx);
    const units = OperationView.units(ctx).map((unit) => {
      if (unordered && ctx.isRejected(unit.index)) return unit;
      if (!unordered) return transform(unit);
      try {
        return transform(unit);
      } catch (error) {
        if (!(error instanceof TypemoError)) throw error;
        ctx.reject(unit.index, error);
        return unit;
      }
    });
    OperationView.apply(ctx, units);
  }

  /**
   * Like {@link map}, with an async transform (validators may be async).
   *
   * @param ctx - The operation context.
   * @param transform - Turns one unit into its new value.
   * @throws {TypemoError} What `transform` throws, in an ordered operation; any other error in every case.
   */
  static async mapAsync(ctx: OperationContext, transform: (unit: WorkUnit) => Promise<WorkUnit>): Promise<void> {
    const unordered = OperationView.unordered(ctx);
    const units: WorkUnit[] = [];
    for (const unit of OperationView.units(ctx)) {
      if (unordered && ctx.isRejected(unit.index)) {
        units.push(unit);
        continue;
      }
      if (!unordered) {
        units.push(await transform(unit));
        continue;
      }
      try {
        units.push(await transform(unit));
      } catch (error) {
        if (!(error instanceof TypemoError)) throw error;
        ctx.reject(unit.index, error);
        units.push(unit);
      }
    }
    OperationView.apply(ctx, units);
  }

  /**
   * The unit of one `bulkWrite` operation.
   *
   * @param operation - The operation model.
   * @param index - Its position in the user's input.
   * @returns The unit.
   */
  private static bulkUnit(operation: BulkWriteModel, index: number): WorkUnit {
    if ("insertOne" in operation)
      return { kind: "insertOne", index, document: operation.insertOne.document, upsert: false };
    if ("updateOne" in operation || "updateMany" in operation) {
      const kind = "updateOne" in operation ? "updateOne" : "updateMany";
      const spec = "updateOne" in operation ? operation.updateOne : operation.updateMany;
      /* One object, optional keys only when present: no copy per key. */
      const unit: Mutable<WorkUnit> = {
        kind,
        index,
        filter: spec.filter,
        update: spec.update,
        upsert: spec.upsert === true,
      };
      if (spec.arrayFilters !== undefined) unit.arrayFilters = spec.arrayFilters;
      if (spec.hint !== undefined) unit.hint = spec.hint;
      return unit;
    }
    if ("replaceOne" in operation) {
      const spec = operation.replaceOne;
      return set(
        { kind: "replaceOne", index, filter: spec.filter, replacement: spec.replacement, upsert: spec.upsert === true },
        "hint",
        spec.hint,
      );
    }
    if ("deleteOne" in operation) {
      return set(
        { kind: "deleteOne", index, filter: operation.deleteOne.filter, upsert: false },
        "hint",
        operation.deleteOne.hint,
      );
    }
    return set(
      { kind: "deleteMany", index, filter: operation.deleteMany.filter, upsert: false },
      "hint",
      operation.deleteMany.hint,
    );
  }

  /**
   * The `bulkWrite` operation model of a unit (the inverse of `bulkUnit`).
   *
   * @param unit - The unit.
   * @returns The frozen operation model.
   */
  private static bulkModel(unit: WorkUnit): BulkWriteModel {
    switch (unit.kind) {
      case "insertOne":
        return Object.freeze({ insertOne: Object.freeze({ document: unit.document as PlanDocument }) });
      case "updateOne":
      case "updateMany": {
        const spec = Object.freeze({
          filter: unit.filter as PlanDocument,
          update: unit.update as PlanDocument,
          ...(unit.upsert ? { upsert: true } : {}),
          ...(unit.arrayFilters === undefined ? {} : { arrayFilters: unit.arrayFilters }),
          ...(unit.hint === undefined ? {} : { hint: unit.hint }),
        });
        return Object.freeze(unit.kind === "updateOne" ? { updateOne: spec } : { updateMany: spec });
      }
      case "replaceOne":
        return Object.freeze({
          replaceOne: Object.freeze({
            filter: unit.filter as PlanDocument,
            replacement: unit.replacement as PlanDocument,
            ...(unit.upsert ? { upsert: true } : {}),
            ...(unit.hint === undefined ? {} : { hint: unit.hint }),
          }),
        });
      case "deleteOne":
        return Object.freeze({
          deleteOne: Object.freeze({
            filter: unit.filter as PlanDocument,
            ...(unit.hint === undefined ? {} : { hint: unit.hint }),
          }),
        });
      default:
        return Object.freeze({
          deleteMany: Object.freeze({
            filter: unit.filter as PlanDocument,
            ...(unit.hint === undefined ? {} : { hint: unit.hint }),
          }),
        });
    }
  }
}
