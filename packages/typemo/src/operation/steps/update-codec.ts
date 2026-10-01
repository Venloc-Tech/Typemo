import { BsonGuards } from "../../bson/bson-guards.ts";
import { CastError } from "../../errors/cast-error.ts";
import { SafeRecord } from "../../internal/safe-record.ts";
import { PolicyErrors } from "../../policies/policy-errors.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";
import { SchemaWalker } from "../../schema/compiler/schema-walker.ts";
import { FilterCodec, type FilterMode } from "./filter-codec.ts";
import { PathResolver, type ResolvedPath } from "./path-resolver.ts";

/*
 * One walk over an update document (Mongoose `castUpdate`), like `FilterCodec` for filters:
 * the grammar of every update operator is here, the leaves are cast (hydrated values, code
 * paths) or encoded (before execute: database names, wire values). Update pipelines are not walked here (they
 * are typed `fn.*` expressions): their paths are translated by the aggregation translator, their constants are
 * cast and their computed values guarded by `PipelineGuard`.
 */

/** The scalar types `$inc` and `$mul` apply to. */
const NUMERIC_TYPES = new Set(["number", "double", "int32", "long", "decimal128"]);
/** The scalar types `$bit` applies to. */
const INTEGER_TYPES = new Set(["number", "int32", "long"]);
/** The node kinds `$min` and `$max` apply to. */
const ORDERABLE_KINDS = new Set(["scalar", "union"]);

/**
 * Appends `key` to a dotted path.
 *
 * @param base - The path so far; empty for the root.
 * @param key - The key to append.
 * @returns The extended path.
 */
const join = (base: string, key: string): string => (base === "" ? key : `${base}.${key}`);

/**
 * Throws a `CastError` of reason `type`; the return type is `never` so callers can `return fail(...)`.
 *
 * @param path - The path of the value.
 * @param value - The rejected value.
 * @param expected - What was expected.
 * @param detail - Why the value is rejected.
 * @throws {CastError} Always.
 */
const fail = (path: string, value: unknown, expected: string, detail: string): never => {
  throw new CastError({ path, value, expected, reason: "type", detail });
};

/**
 * The scalar type of a node, `undefined` for other kinds.
 *
 * @param node - The path node.
 * @returns The type name, or `undefined`.
 */
const scalarType = (node: PathNode): string | undefined => (node.kind === "scalar" ? node.type : undefined);

/**
 * Every `$[id]` element node of the paths of an update (for arrayFilters).
 *
 * @example
 * const nodes: IdentifierNodes = new Map([["item", itemNode]]);
 */
export type IdentifierNodes = ReadonlyMap<string, PathNode>;

/**
 * Casts and encodes update documents and their arrayFilters.
 *
 * @example
 * const cast = UpdateCodec.walk(schema, { $set: { name: "a" } }, "cast");
 * const encoded = UpdateCodec.walk(schema, cast, "encode"); // database names, wire values
 */
export class UpdateCodec {
  /**
   * Resolves a path written by an update (update mode); unknown → strict error.
   *
   * @param schema - The compiled schema.
   * @param path - The path in code names.
   * @param at - Where the path sits in the update, for the error.
   * @returns The resolved path.
   * @throws {PolicyError} When the path does not exist in the schema.
   */
  static resolve(schema: CompiledSchema, path: string, at: string): ResolvedPath {
    const resolution = PathResolver.resolve(schema, path, "update");
    if (!resolution.ok) throw PolicyErrors.strict("unknown-path", resolution.reason, at);
    return resolution.value;
  }

  /**
   * The update walked with `mode`.
   *
   * @param schema - The compiled schema.
   * @param update - The update document (operators over paths).
   * @param mode - `cast` casts the values, `encode` writes database names and wire values.
   * @returns A new frozen update.
   * @throws {PolicyError} When an operand is not an object or a path is unknown.
   * @throws {CastError} When a value does not fit its field.
   */
  static walk(schema: CompiledSchema, update: PlanDocument, mode: FilterMode): PlanDocument {
    const out: Record<string, unknown> = {};
    for (const [operator, operand] of Object.entries(update)) {
      if (!BsonGuards.isPlainObject(operand)) {
        throw PolicyErrors.strict("sanitize", `update: "${operator}" takes an object of paths`, operator);
      }
      const fields: Record<string, unknown> = {};
      for (const [path, value] of Object.entries(operand)) {
        const at = join(operator, path);
        const resolved = UpdateCodec.resolve(schema, path, at);
        const key = mode === "encode" ? resolved.dbPath : path;
        SafeRecord.set(fields, key, UpdateCodec.operand(schema, operator, resolved, value, mode, at));
      }
      SafeRecord.set(out, operator, Object.freeze(fields));
    }
    return Object.freeze(out);
  }

  /**
   * The `$[id]` element nodes of every path of an update.
   *
   * @param schema - The compiled schema.
   * @param update - The update document.
   * @returns The element node of each identifier.
   * @throws {PolicyError} When a path is unknown.
   */
  static identifiers(schema: CompiledSchema, update: PlanDocument): IdentifierNodes {
    const found = new Map<string, PathNode>();
    for (const [operator, operand] of Object.entries(update)) {
      if (!BsonGuards.isPlainObject(operand)) continue;
      for (const path of Object.keys(operand)) {
        for (const [id, node] of UpdateCodec.resolve(schema, path, join(operator, path)).identifiers)
          found.set(id, node);
      }
    }
    return found;
  }

  /**
   * arrayFilters walked against the `$[id]` elements (`{ "r.lines": { $gt: 1 } }`, `{ s: { $gte: 5 } }`).
   *
   * @param filters - The array filters.
   * @param identifiers - The element node of each identifier.
   * @param mode - `cast` or `encode`.
   * @returns The frozen filters.
   * @throws {PolicyError} When a filter names an identifier the update does not use, or an unknown path.
   * @throws {CastError} When a value does not fit its field.
   */
  static arrayFilters(
    filters: readonly PlanDocument[],
    identifiers: IdentifierNodes,
    mode: FilterMode,
  ): readonly PlanDocument[] {
    return Object.freeze(
      filters.map((filter, index) => UpdateCodec.arrayFilter(filter, identifiers, mode, `arrayFilters.${index}`)),
    );
  }

  /**
   * One array filter: `$and`/`$or`/`$nor` are walked, every other key starts with an identifier.
   *
   * @param filter - The array filter.
   * @param identifiers - The element node of each identifier.
   * @param mode - `cast` or `encode`.
   * @param at - Where the filter sits, for errors.
   * @returns The frozen filter.
   * @throws {PolicyError} On an empty logical list, an unknown identifier or an unknown path.
   * @throws {CastError} When a value does not fit its field.
   */
  private static arrayFilter(
    filter: PlanDocument,
    identifiers: IdentifierNodes,
    mode: FilterMode,
    at: string,
  ): PlanDocument {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filter)) {
      const path = join(at, key);
      if (key === "$and" || key === "$or" || key === "$nor") {
        if (!Array.isArray(value) || value.length === 0) {
          throw PolicyErrors.strict("empty-logical", `${key} must be a non-empty array (at "${path}")`, path);
        }
        SafeRecord.set(
          out,
          key,
          Object.freeze(
            value.map((clause: unknown, index) =>
              UpdateCodec.arrayFilter(clause as PlanDocument, identifiers, mode, join(path, String(index))),
            ),
          ),
        );
        continue;
      }
      const [id, ...rest] = key.split(".");
      const element = identifiers.get(id ?? "");
      if (element === undefined) {
        throw PolicyErrors.strict("unknown-path", `arrayFilters: "${id}" is not an identifier of the update`, path);
      }
      if (rest.length === 0) {
        const resolved: ResolvedPath = {
          node: element,
          path: key,
          dbPath: key,
          nullable: element.nullable,
          identifiers,
        };
        SafeRecord.set(out, key, FilterCodec.condition(resolved, value, mode, path));
        continue;
      }
      const resolution = PathResolver.resolve(element, rest.join("."), "filter");
      if (!resolution.ok) throw PolicyErrors.strict("unknown-path", resolution.reason, path);
      const outKey = mode === "encode" ? `${id}.${resolution.value.dbPath}` : key;
      SafeRecord.set(out, outKey, FilterCodec.condition(resolution.value, value, mode, path));
    }
    return Object.freeze(out);
  }

  /**
   * One leaf value: cast, or encoded to its wire form.
   *
   * @param node - The path node.
   * @param value - The value.
   * @param mode - `cast` or `encode`.
   * @param at - Where the value sits, for errors.
   * @returns The cast or encoded value.
   * @throws {CastError} When the value does not fit the field (`cast`).
   */
  private static value(node: PathNode, value: unknown, mode: FilterMode, at: string): unknown {
    return mode === "cast" ? node.caster.cast(value, at) : SchemaWalker.encodeValue(node, value);
  }

  /**
   * The operand of one update operator at one path: the grammar of the operator, the leaves cast or encoded.
   *
   * @param schema - The compiled schema.
   * @param operator - The update operator.
   * @param resolved - The resolved path.
   * @param value - The operand value.
   * @param mode - `cast` or `encode`.
   * @param at - Where the operand sits, for errors.
   * @returns The cast or encoded operand.
   * @throws {PolicyError} When the operator does not apply to the field or is unknown.
   * @throws {CastError} When the operand has the wrong shape or type.
   */
  private static operand(
    schema: CompiledSchema,
    operator: string,
    resolved: ResolvedPath,
    value: unknown,
    mode: FilterMode,
    at: string,
  ): unknown {
    const node = resolved.node;
    switch (operator) {
      case "$set":
      case "$setOnInsert":
        return UpdateCodec.value(node, value, mode, at);
      case "$unset":
        if (value !== "" && value !== 1 && value !== true)
          return fail(at, value, '"" | 1 | true', "$unset takes an empty string");
        return "";
      case "$inc":
      case "$mul":
        UpdateCodec.requireType(node, NUMERIC_TYPES, operator, at);
        return UpdateCodec.value(node, value, mode, at);
      case "$min":
      case "$max":
        if (!ORDERABLE_KINDS.has(node.kind)) {
          throw PolicyErrors.strict("sanitize", `${operator} applies to comparable values (at "${at}")`, at);
        }
        return UpdateCodec.value(node, value, mode, at);
      case "$currentDate": {
        const type = scalarType(node);
        if (type !== "date" && type !== "timestamp") {
          throw PolicyErrors.strict("sanitize", `$currentDate applies to Date or Timestamp fields (at "${at}")`, at);
        }
        const valid =
          (value === true && type === "date") ||
          (BsonGuards.isPlainObject(value) && Object.keys(value).length === 1 && value.$type === type);
        if (!valid) return fail(at, value, `true | { $type: "${type}" }`, `$currentDate of a ${type} field`);
        return value;
      }
      case "$rename": {
        if (typeof value !== "string") return fail(at, value, "path", "$rename takes the new path");
        const target = UpdateCodec.resolve(schema, value, at);
        if (!UpdateCodec.sameKind(node, target.node)) {
          throw PolicyErrors.strict(
            "sanitize",
            `$rename "${resolved.path}" → "${value}": the types differ (at "${at}")`,
            at,
          );
        }
        return mode === "encode" ? target.dbPath : value;
      }
      case "$push":
      case "$addToSet":
        return UpdateCodec.push(operator, node, value, mode, at);
      case "$pull":
        return UpdateCodec.pull(node, value, mode, at);
      case "$pullAll": {
        const array = UpdateCodec.requireArray(node, operator, at);
        if (!Array.isArray(value)) return fail(at, value, "Array", "$pullAll takes an array of elements");
        return Object.freeze(
          value.map((item: unknown, index) => UpdateCodec.value(array.element, item, mode, join(at, String(index)))),
        );
      }
      case "$pop":
        UpdateCodec.requireArray(node, operator, at);
        if (value !== 1 && value !== -1) return fail(at, value, "1 | -1", "$pop takes 1 (last) or -1 (first)");
        return value;
      case "$bit": {
        UpdateCodec.requireType(node, INTEGER_TYPES, operator, at);
        if (!BsonGuards.isPlainObject(value) || Object.keys(value).length === 0) {
          return fail(at, value, "{ and | or | xor: integer }", "$bit takes and/or/xor");
        }
        const out: Record<string, unknown> = {};
        for (const [op, operand] of Object.entries(value)) {
          if (op !== "and" && op !== "or" && op !== "xor")
            return fail(join(at, op), value, "and | or | xor", "$bit operation");
          SafeRecord.set(out, op, UpdateCodec.value(node, operand, mode, join(at, op)));
        }
        return Object.freeze(out);
      }
      default:
        throw PolicyErrors.strict("sanitize", `"${operator}" is not an update operator`, operator);
    }
  }

  /**
   * The operand of `$push`/`$addToSet`: one element, or `$each` with its modifiers.
   *
   * @param operator - `$push` or `$addToSet`.
   * @param node - The array node.
   * @param value - The operand.
   * @param mode - `cast` or `encode`.
   * @param at - Where the operand sits, for errors.
   * @returns The cast or encoded operand.
   * @throws {PolicyError} When the field is not an array or a modifier is unknown.
   * @throws {CastError} When a modifier or an element has the wrong type.
   */
  private static push(operator: string, node: PathNode, value: unknown, mode: FilterMode, at: string): unknown {
    const array = UpdateCodec.requireArray(node, operator, at);
    if (!(BsonGuards.isPlainObject(value) && "$each" in value))
      return UpdateCodec.value(array.element, value, mode, at);
    const out: Record<string, unknown> = {};
    for (const [modifier, operand] of Object.entries(value)) {
      const where = join(at, modifier);
      switch (modifier) {
        case "$each":
          if (!Array.isArray(operand)) return fail(where, operand, "Array", "$each takes an array");
          SafeRecord.set(
            out,
            modifier,
            Object.freeze(
              operand.map((item: unknown, index) =>
                UpdateCodec.value(array.element, item, mode, join(where, String(index))),
              ),
            ),
          );
          break;
        case "$position":
        case "$slice":
          if (operator !== "$push") return fail(where, operand, "$each", `${modifier} is a $push modifier`);
          if (!Number.isInteger(operand)) return fail(where, operand, "integer", `${modifier} takes an integer`);
          SafeRecord.set(out, modifier, operand);
          break;
        case "$sort":
          if (operator !== "$push") return fail(where, operand, "$each", "$sort is a $push modifier");
          SafeRecord.set(out, modifier, UpdateCodec.pushSort(array.element, operand, mode, where));
          break;
        default:
          throw PolicyErrors.strict(
            "sanitize",
            `"${modifier}" is not a modifier of ${operator} (at "${where}")`,
            where,
          );
      }
    }
    return Object.freeze(out);
  }

  /**
   * The `$sort` modifier of `$push`: a direction, or paths of the element with directions.
   *
   * @param element - The element node of the array.
   * @param sort - The modifier value.
   * @param mode - `cast` or `encode`.
   * @param at - Where the modifier sits, for errors.
   * @returns The modifier, with database names in `encode` mode.
   * @throws {PolicyError} When a sorted path is unknown.
   * @throws {CastError} When the shape or a direction is invalid.
   */
  private static pushSort(element: PathNode, sort: unknown, mode: FilterMode, at: string): unknown {
    if (sort === 1 || sort === -1) return sort;
    if (!BsonGuards.isPlainObject(sort) || Object.keys(sort).length === 0) {
      return fail(at, sort, "1 | -1 | { path: 1 | -1 }", "$sort of $push");
    }
    const out: Record<string, unknown> = {};
    for (const [path, direction] of Object.entries(sort)) {
      if (direction !== 1 && direction !== -1) return fail(join(at, path), direction, "1 | -1", "a sort direction");
      const resolution = PathResolver.resolve(element, path, "read");
      if (!resolution.ok) throw PolicyErrors.strict("unknown-path", resolution.reason, join(at, path));
      SafeRecord.set(out, mode === "encode" ? resolution.value.dbPath : path, direction);
    }
    return Object.freeze(out);
  }

  /**
   * The operand of `$pull`: a condition on the elements (a filter for documents).
   *
   * @param node - The array node.
   * @param value - The operand.
   * @param mode - `cast` or `encode`.
   * @param at - Where the operand sits, for errors.
   * @returns The cast or encoded condition.
   * @throws {PolicyError} When the field is not an array.
   * @throws {CastError} When documents are pulled with a non-object condition.
   */
  private static pull(node: PathNode, value: unknown, mode: FilterMode, at: string): unknown {
    const array = UpdateCodec.requireArray(node, "$pull", at);
    const element = array.element;
    if (element.kind === "subdocument" || element.kind === "nested") {
      if (!BsonGuards.isPlainObject(value))
        return fail(at, value, "a condition", "$pull of documents takes a condition");
      return FilterCodec.walk(value, element, mode, at);
    }
    const resolved: ResolvedPath = {
      node: element,
      path: at,
      dbPath: at,
      nullable: element.nullable,
      identifiers: new Map(),
    };
    return FilterCodec.condition(resolved, value, mode, at);
  }

  /**
   * Requires an array node.
   *
   * @param node - The path node.
   * @param operator - The operator, for the error.
   * @param at - Where the operand sits, for the error.
   * @returns `node`, narrowed to an array node.
   * @throws {PolicyError} When the node is not an array.
   */
  private static requireArray(node: PathNode, operator: string, at: string): Extract<PathNode, { kind: "array" }> {
    if (node.kind !== "array") throw PolicyErrors.strict("sanitize", `${operator} applies to arrays (at "${at}")`, at);
    return node;
  }

  /**
   * Requires a scalar node of one of the allowed types.
   *
   * @param node - The path node.
   * @param allowed - The allowed scalar types.
   * @param operator - The operator, for the error.
   * @param at - Where the operand sits, for the error.
   * @throws {PolicyError} When the node is not a scalar of an allowed type.
   */
  private static requireType(node: PathNode, allowed: ReadonlySet<string>, operator: string, at: string): void {
    const type = scalarType(node);
    if (type === undefined || !allowed.has(type)) {
      throw PolicyErrors.strict("sanitize", `${operator} does not apply to this field (at "${at}")`, at);
    }
  }

  /**
   * Whether two nodes hold the same kind of value (for `$rename`): same scalar type, same element kind, same
   * embedded class.
   *
   * @param a - The first node.
   * @param b - The second node.
   * @returns `true` when a value of one can move to the other.
   */
  private static sameKind(a: PathNode, b: PathNode): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "scalar" && b.kind === "scalar") return a.type === b.type;
    if (a.kind === "array" && b.kind === "array") return UpdateCodec.sameKind(a.element, b.element);
    if ((a.kind === "subdocument" || a.kind === "nested") && (b.kind === "subdocument" || b.kind === "nested")) {
      return a.target === b.target;
    }
    return true;
  }
}
