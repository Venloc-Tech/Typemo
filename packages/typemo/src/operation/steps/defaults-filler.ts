import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../../bson/bson-guards.ts";
import { SafeRecord } from "../../internal/safe-record.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";
import { PathResolver } from "./path-resolver.ts";

/*
 * Defaults, timestamps and the version key (service fields are filled by the core, never by base-class constructors).
 * Works on CAST values (code names, hydrated): nothing is cast twice —
 * a user `set` runs once (Mongoose H508 "setters once, not twice").
 *
 * - insert (and every new embedded document: `$set` of a subdocument, `$push`/`$addToSet` elements): every
 *   absent field with a default gets a fresh default value; `createdAt`/`updatedAt` = the operation's
 *   clock; `__v` = 0; `_id` from its default (`Entity`) so the id is known before the insert;
 * - update: `updatedAt` = now (`$set`), unless the update writes it itself;
 * - upsert: `createdAt`, `__v` and the defaults of top-level fields go to `$setOnInsert` (Mongoose H402,
 *   H021: only with upsert), unless the update writes the path, an ancestor or a descendant (H450) or
 *   the filter fixes it by equality (the server copies those into the new document, H056);
 * - update pipeline: `updatedAt` appended as a `$set` stage; on upsert `createdAt`/`__v` via `$ifNull`.
 */

/**
 * What a fill writes besides schema defaults.
 *
 * @example
 * const clock: FillClock = { now: new Date() };
 */
export interface FillClock {
  /** The operation's clock: every timestamp of one operation is this instant. */
  readonly now: Date;
}

/** The logical operators of a filter. */
const LOGICAL = new Set(["$and", "$or", "$nor"]);

/**
 * Fills defaults, timestamps and versions.
 *
 * @example
 * const filled = DefaultsFiller.document(schema, { name: "a" }, { now: new Date() });
 * // { name: "a", createdAt: <now>, updatedAt: <now>, __v: 0, ...defaults }
 */
export class DefaultsFiller {
  /**
   * A new document of `schema` (insert, replacement): absent fields filled, embedded documents too.
   *
   * @param base - The compiled schema; a discriminator's schema is picked by the document's key.
   * @param document - The cast document.
   * @param clock - The operation's clock.
   * @param replacement - Whether the document is a replacement (it keeps the stored `_id`, timestamps and `__v`).
   * @returns A new frozen document in schema key order.
   */
  static document(base: CompiledSchema, document: PlanDocument, clock: FillClock, replacement = false): PlanDocument {
    const schema = DefaultsFiller.schemaOf(base, document);
    /* Keys in schema order (Mongoose H421: the stored order follows the schema, not the input). */
    const out: Record<string, unknown> = {};
    for (const node of schema.fields) {
      if (Object.hasOwn(document, node.key)) {
        SafeRecord.set(out, node.key, DefaultsFiller.embedded(node, document[node.key], clock));
        continue;
      }
      /*
       * A replacement keeps the stored `_id` (the server refuses to change it): no new id is made up. The
       * timestamps and `__v` are kept or bumped by the executor's update pipeline (ReplacementPipeline).
       */
      if (replacement && node.service !== undefined && node.service !== "discriminatorKey") continue;
      const value = DefaultsFiller.initial(node, clock);
      if (value !== undefined) SafeRecord.set(out, node.key, value);
    }
    for (const [key, value] of Object.entries(document)) if (!Object.hasOwn(out, key)) SafeRecord.set(out, key, value);
    return Object.freeze(out);
  }

  /**
   * The value a new document gets for an absent field (`undefined`: none).
   *
   * @param node - The path node.
   * @param clock - The operation's clock.
   * @returns The fresh value: the clock for timestamps, `0` for the version key, else the default.
   */
  private static initial(node: PathNode, clock: FillClock): unknown {
    switch (node.service) {
      case "createdAt":
      case "updatedAt":
        return new Date(clock.now.getTime());
      case "version":
        return 0;
      default:
        return node.defaultValue === undefined ? undefined : DefaultsFiller.embedded(node, node.defaultValue(), clock);
    }
  }

  /**
   * Fills the embedded documents inside a value of `node` (a subdocument, arrays and Maps of them).
   *
   * @param node - The path node.
   * @param value - The cast value.
   * @param clock - The operation's clock.
   * @returns The value with its embedded documents filled (arrays are new frozen arrays, Maps new Maps).
   */
  static embedded(node: PathNode, value: unknown, clock: FillClock): unknown {
    if (value === null || value === undefined) return value;
    switch (node.kind) {
      case "subdocument":
      case "nested":
        return BsonGuards.isPlainObject(value) ? DefaultsFiller.document(node.schema, value, clock) : value;
      case "array":
        return Array.isArray(value)
          ? Object.freeze(value.map((item: unknown) => DefaultsFiller.embedded(node.element, item, clock)))
          : value;
      case "map": {
        if (!BsonGuards.isMap(value)) return value;
        const out = new Map<unknown, unknown>();
        for (const [key, item] of value) out.set(key, DefaultsFiller.embedded(node.value, item, clock));
        return out;
      }
      default:
        return value;
    }
  }

  /**
   * An operator update: new embedded documents filled, `updatedAt`, and the upsert-only fields.
   *
   * @param schema - The compiled schema.
   * @param update - The cast update (operators over paths).
   * @param filter - The cast filter, used to find the paths an upsert copies from it.
   * @param upsert - Whether the update is an upsert.
   * @param clock - The operation's clock.
   * @returns A new frozen update; `updatedAt` goes to `$set`, defaults, `createdAt` and `__v` to `$setOnInsert`.
   */
  static update(
    schema: CompiledSchema,
    update: PlanDocument,
    filter: PlanDocument | undefined,
    upsert: boolean,
    clock: FillClock,
  ): PlanDocument {
    const out: Record<string, Record<string, unknown>> = {};
    const written: string[] = [];
    for (const [operator, operand] of Object.entries(update)) {
      const fields: Record<string, unknown> = {};
      for (const [path, value] of Object.entries(operand as PlanDocument)) {
        written.push(path);
        if (operator === "$rename" && typeof value === "string") written.push(value);
        SafeRecord.set(fields, path, DefaultsFiller.operand(schema, operator, path, value, clock));
      }
      SafeRecord.set(out, operator, fields);
    }
    const touched = (path: string): boolean =>
      written.some((other) => other === path || other.startsWith(`${path}.`) || path.startsWith(`${other}.`));
    const put = (operator: "$set" | "$setOnInsert", path: string, value: unknown): void => {
      const fields = out[operator] ?? {};
      SafeRecord.set(fields, path, value);
      SafeRecord.set(out, operator, fields);
    };
    for (const node of schema.fields) {
      if (node.service === "updatedAt" && !touched(node.key)) put("$set", node.key, new Date(clock.now.getTime()));
    }
    if (upsert) {
      const fixed = DefaultsFiller.equalityPaths(filter);
      const isFixed = (path: string): boolean =>
        fixed.some((other) => other === path || other.startsWith(`${path}.`) || path.startsWith(`${other}.`));
      for (const node of schema.fields) {
        if (node.service === "id" || node.service === "updatedAt" || node.service === "discriminatorKey") continue;
        if (touched(node.key) || isFixed(node.key)) continue;
        const value = DefaultsFiller.initial(node, clock);
        if (value !== undefined) put("$setOnInsert", node.key, value);
      }
    }
    const frozen: Record<string, unknown> = {};
    for (const [operator, fields] of Object.entries(out)) SafeRecord.set(frozen, operator, Object.freeze(fields));
    return Object.freeze(frozen);
  }

  /**
   * An update pipeline: `updatedAt` stage appended; on upsert `createdAt`/`__v` only when absent.
   *
   * @param schema - The compiled schema.
   * @param stages - The stages of the update pipeline.
   * @param upsert - Whether the update is an upsert.
   * @param clock - The operation's clock.
   * @returns The stages, with one `$set` stage appended when a service field must be written.
   */
  static pipeline(
    schema: CompiledSchema,
    stages: readonly PipelineStage[],
    upsert: boolean,
    clock: FillClock,
  ): readonly PipelineStage[] {
    const set: Record<string, unknown> = {};
    const writes = (key: string): boolean =>
      stages.some((stage) => {
        const spec = stage.$set ?? stage.$addFields;
        return (
          BsonGuards.isPlainObject(spec) && Object.keys(spec).some((path) => path === key || path.startsWith(`${key}.`))
        );
      });
    for (const node of schema.fields) {
      if (writes(node.key)) continue;
      const now = new Date(clock.now.getTime());
      if (node.service === "updatedAt") SafeRecord.set(set, node.key, Object.freeze({ $literal: now }));
      if (upsert && node.service === "createdAt") {
        SafeRecord.set(
          set,
          node.key,
          Object.freeze({ $ifNull: Object.freeze([`$${node.key}`, Object.freeze({ $literal: now })]) }),
        );
      }
      if (upsert && node.service === "version") {
        SafeRecord.set(set, node.key, Object.freeze({ $ifNull: Object.freeze([`$${node.key}`, 0]) }));
      }
    }
    if (Object.keys(set).length === 0) return stages;
    return Object.freeze([...stages, Object.freeze({ $set: Object.freeze(set) })]);
  }

  /**
   * New embedded documents inside an update operand get their defaults and timestamps.
   *
   * @param schema - The compiled schema.
   * @param operator - The update operator.
   * @param path - The path the operand writes.
   * @param value - The cast operand value.
   * @param clock - The operation's clock.
   * @returns The operand with its embedded documents filled; other operators' operands unchanged.
   */
  private static operand(
    schema: CompiledSchema,
    operator: string,
    path: string,
    value: unknown,
    clock: FillClock,
  ): unknown {
    if (operator !== "$set" && operator !== "$setOnInsert" && operator !== "$push" && operator !== "$addToSet")
      return value;
    const resolution = PathResolver.resolve(schema, path, "update");
    if (!resolution.ok) return value;
    const node = resolution.value.node;
    if (operator === "$set" || operator === "$setOnInsert") return DefaultsFiller.embedded(node, value, clock);
    if (node.kind !== "array") return value;
    if (BsonGuards.isPlainObject(value) && Array.isArray(value.$each)) {
      return Object.freeze({ ...value, $each: DefaultsFiller.embedded(node, value.$each, clock) });
    }
    return DefaultsFiller.embedded(node.element, value, clock);
  }

  /**
   * Paths a filter fixes by equality (top level and `$and`): the server copies them into an upserted document.
   *
   * @param filter - The cast filter, if any.
   * @returns The paths.
   */
  static equalityPaths(filter: PlanDocument | undefined): string[] {
    if (filter === undefined) return [];
    const out: string[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (key === "$and" && Array.isArray(value)) {
        for (const clause of value)
          if (BsonGuards.isPlainObject(clause)) out.push(...DefaultsFiller.equalityPaths(clause));
        continue;
      }
      if (key.startsWith("$") || LOGICAL.has(key)) continue;
      const operators = BsonGuards.isPlainObject(value) && Object.keys(value).every((k) => k.startsWith("$"));
      if (!operators || (BsonGuards.isPlainObject(value) && "$eq" in value)) out.push(key);
    }
    return out;
  }

  /**
   * The discriminator schema of a document by its key (the base when absent or unknown).
   *
   * @param base - The base schema.
   * @param document - The document.
   * @returns The discriminator's schema, or `base`.
   */
  private static schemaOf(base: CompiledSchema, document: PlanDocument): CompiledSchema {
    if (base.discriminators.size === 0 || !Object.hasOwn(document, base.discriminatorKey)) return base;
    return base.root.discriminatorFor(document[base.discriminatorKey]) ?? base;
  }
}
