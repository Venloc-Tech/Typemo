import { BsonGuards } from "../../bson/bson-guards.ts";
import { RegExpCaster } from "../../bson/casters/reg-exp-caster.ts";
import { CastError } from "../../errors/cast-error.ts";
import { SafeRecord } from "../../internal/safe-record.ts";
import { PolicyErrors } from "../../policies/policy-errors.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";
import { SchemaWalker } from "../../schema/compiler/schema-walker.ts";
import { ExpressionPaths } from "./expression-paths.ts";
import { PathResolver, type ResolvedPath, type ResolveRoot } from "./path-resolver.ts";

/*
 * One walk over a query filter, by the schema (the cast and the wire encoding before execute).
 * The walk knows the grammar of a filter — logical clauses, `$expr`, field conditions, the operators
 * and the shape of each operand — and delegates only the leaves:
 * - `cast`: every compared value through the caster of its node (strict casts, the safe list;
 *   `set`/`trim`/`lowercase` apply to compared values too — Mongoose H508 — but never to a regex);
 *   keys stay code paths; the result is the hydrated form the validators and hooks see;
 * - `encode` (last step before execute): keys to database names (Mongoose H14), values to the wire form
 *   (`Int32`/`Double` wrappers, Maps as objects, subdocuments with database names), `$expr` field
 *   references translated.
 * Nothing is mutated; every level is a new frozen object.
 */

/**
 * What a walk does at the leaves.
 *
 * @example
 * const mode: FilterMode = "encode";
 */
export type FilterMode = "cast" | "encode";

/** The logical operators, whose operand is a non-empty list of filters. */
const LOGICAL = new Set(["$and", "$or", "$nor"]);
/** Root operators whose operand is data the walk keeps as is. */
const ROOT_OPAQUE = new Set(["$text", "$comment", "$jsonSchema", "$sampleRate"]);
/** The comparison operators, whose operand is a value of the field. */
const COMPARISON = new Set(["$eq", "$ne", "$gt", "$gte", "$lt", "$lte"]);
/** The bitwise query operators. */
const BITS = new Set(["$bitsAllSet", "$bitsAnySet", "$bitsAllClear", "$bitsAnyClear"]);
/** The geospatial query operators. */
const GEO = new Set(["$near", "$nearSphere", "$geoWithin", "$geoIntersects", "$maxDistance", "$minDistance"]);
/** The BSON type aliases `$type` accepts. */
const TYPE_ALIASES = new Set([
  "double",
  "string",
  "object",
  "array",
  "binData",
  "objectId",
  "bool",
  "date",
  "null",
  "regex",
  "javascript",
  "int",
  "timestamp",
  "long",
  "decimal",
  "minKey",
  "maxKey",
  "number",
]);
/** The scalar types `$mod` and the bit operators apply to. */
const INTEGER_TYPES = new Set(["number", "int32", "long", "double"]);
/** The flags `$options` accepts. */
const REGEX_OPTIONS = /^[imxsu]*$/;

/**
 * Appends `key` to a dotted path.
 *
 * @param base - The path so far; empty for the root.
 * @param key - The key to append.
 * @returns The extended path.
 */
const join = (base: string, key: string): string => (base === "" ? key : `${base}.${key}`);

/**
 * A plain object whose keys all start with `$` (an operator object); `{}` is not one.
 *
 * @param value - The value to test.
 * @returns Whether `value` is an operator object.
 */
const isOperatorObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  BsonGuards.isPlainObject(value) &&
  Object.keys(value).length > 0 &&
  Object.keys(value).every((k) => k.startsWith("$"));

/**
 * `true` for a `RegExp` or a BSON regular expression.
 *
 * @param value - The value to test.
 * @returns Whether `value` is a regular expression.
 */
const isRegex = (value: unknown): boolean => BsonGuards.isRegExp(value) || BsonGuards.isBsonRegExp(value);

/**
 * The scalar types a node stores (the element's, through arrays).
 *
 * @param node - The path node.
 * @returns The type names; empty for embedded documents and Maps.
 */
const scalarTypesOf = (node: PathNode): readonly string[] => {
  switch (node.kind) {
    case "scalar":
      return [node.type];
    case "union":
      return node.members;
    case "array":
      return scalarTypesOf(node.element);
    default:
      return [];
  }
};

/**
 * Throws a `CastError` of reason `type`; the return type is `never` so callers can `return castFail(...)`.
 *
 * @param path - The path of the value.
 * @param value - The rejected value.
 * @param expected - What was expected.
 * @param detail - Why the value is rejected.
 * @throws {CastError} Always.
 */
const castFail = (path: string, value: unknown, expected: string, detail: string): never => {
  throw new CastError({ path, value, expected, reason: "type", detail });
};

/**
 * Casts and encodes filters.
 *
 * @example
 * const cast = FilterCodec.cast(schema, { age: { $gt: "18" } }); // { age: { $gt: 18 } }
 * const wire = FilterCodec.encode(schema, cast); // database names and wire values
 */
export class FilterCodec {
  /**
   * The filter walked from a document schema (or an element node for `$elemMatch`/arrayFilters). With
   * `keep` (aggregation `$match` after fields were added or replaced), a key for which it returns `true`,
   * or that is not a path of the schema, is kept as written: the pipeline types checked it, its value is
   * not a value of the schema.
   *
   * @param filter - The filter.
   * @param root - A document schema, or an element node.
   * @param mode - `cast` or `encode`.
   * @param at - Where the filter sits, for errors.
   * @param keep - Tells which keys to keep as written.
   * @returns A new frozen filter.
   * @throws {PolicyError} On an empty logical list, an unknown operator or path, or `undefined`.
   * @throws {CastError} When a value does not fit its field.
   */
  static walk(
    filter: PlanDocument,
    root: ResolveRoot,
    mode: FilterMode,
    at = "",
    keep?: (key: string) => boolean,
  ): PlanDocument {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filter)) {
      const path = join(at, key);
      if (LOGICAL.has(key)) {
        if (!Array.isArray(value) || value.length === 0) {
          throw PolicyErrors.strict("empty-logical", `${key} must be a non-empty array (at "${path}")`, path);
        }
        SafeRecord.set(
          out,
          key,
          Object.freeze(
            value.map((clause: unknown, index) => {
              if (!BsonGuards.isPlainObject(clause)) {
                throw PolicyErrors.strict("sanitize", `${key}[${index}] must be a filter object`, path);
              }
              return FilterCodec.walk(clause, root, mode, join(path, String(index)), keep);
            }),
          ),
        );
        continue;
      }
      if (key === "$expr") {
        SafeRecord.set(out, key, mode === "encode" ? FilterCodec.expression(value, root) : value);
        continue;
      }
      if (ROOT_OPAQUE.has(key)) {
        SafeRecord.set(out, key, value);
        continue;
      }
      if (key.startsWith("$")) {
        throw PolicyErrors.strict(
          "sanitize",
          `"${key}" is not a filter operator at the top level (at "${path}")`,
          path,
        );
      }
      if (keep?.(key) === true) {
        SafeRecord.set(out, key, value);
        continue;
      }
      const resolution = PathResolver.resolve(root, key, "filter");
      if (!resolution.ok && keep !== undefined) {
        SafeRecord.set(out, key, value);
        continue;
      }
      if (!resolution.ok) throw PolicyErrors.strict("unknown-path", resolution.reason, path);
      const resolved = resolution.value;
      SafeRecord.set(
        out,
        mode === "encode" ? resolved.dbPath : key,
        FilterCodec.condition(resolved, value, mode, path),
      );
    }
    return Object.freeze(out);
  }

  /**
   * The condition of one field: an operator object or a value to equal.
   *
   * @param resolved - The resolved path of the field.
   * @param value - An operator object, or the value to equal.
   * @param mode - `cast` or `encode`.
   * @param path - Where the condition sits, for errors.
   * @returns The cast or encoded condition.
   * @throws {PolicyError} On an unknown operator or a misused one.
   * @throws {CastError} When a value does not fit the field.
   */
  static condition(resolved: ResolvedPath, value: unknown, mode: FilterMode, path: string): unknown {
    if (!isOperatorObject(value)) return FilterCodec.equality(resolved.node, value, resolved.nullable, mode, path);
    const out: Record<string, unknown> = {};
    for (const [operator, operand] of Object.entries(value)) {
      SafeRecord.set(
        out,
        operator,
        FilterCodec.operator(resolved, operator, operand, value, mode, join(path, operator)),
      );
    }
    return Object.freeze(out);
  }

  /**
   * A value compared with the path: an element or the whole array for arrays, a regex for strings.
   *
   * @param node - The path node.
   * @param value - The compared value.
   * @param nullable - Whether `null` is a value along the path.
   * @param mode - `cast` or `encode`.
   * @param path - Where the value sits, for errors.
   * @returns The cast or encoded value.
   * @throws {PolicyError} On `undefined` or an object of operators where a value is expected.
   * @throws {CastError} When the value does not fit the field, or `null` on a non-nullable path.
   */
  private static equality(node: PathNode, value: unknown, nullable: boolean, mode: FilterMode, path: string): unknown {
    if (value === null) {
      if (mode === "cast" && !nullable) {
        throw new CastError({
          path,
          value,
          expected: `${node.caster.expected}`,
          reason: "null",
          detail: "null is not a value of this path (it is not nullable); an absent field is { $exists: false }",
        });
      }
      return null;
    }
    if (value === undefined) {
      throw PolicyErrors.strict(
        "undefined",
        `undefined at "${path}" (use $exists: false; undefined is never a value)`,
        path,
      );
    }
    if (isRegex(value) && scalarTypesOf(node).includes("string")) return FilterCodec.regex(value, mode, path);
    if (node.kind === "array" && !Array.isArray(value)) {
      return FilterCodec.equality(node.element, value, nullable || node.element.nullable, mode, path);
    }
    if (isOperatorObject(value)) {
      /* An operator object inside an operand is data for the server, never an operator: refused (H420). */
      throw PolicyErrors.strict(
        "sanitize",
        `an object of operators (${Object.keys(value).join(", ")}) where a value is expected (at "${path}")`,
        path,
      );
    }
    return mode === "cast" ? node.caster.cast(value, path) : SchemaWalker.encodeValue(node, value);
  }

  /**
   * A regular expression operand: cast in `cast` mode, kept in `encode` mode.
   *
   * @param value - The regular expression.
   * @param mode - `cast` or `encode`.
   * @param path - Where the value sits, for errors.
   * @returns The value.
   * @throws {CastError} When the expression cannot be cast.
   */
  private static regex(value: unknown, mode: FilterMode, path: string): unknown {
    if (mode === "encode" || BsonGuards.isBsonRegExp(value)) return value;
    return RegExpCaster.cast(value, path);
  }

  /**
   * One operator of a field condition: the shape of its operand is checked, its values cast or encoded.
   *
   * @param resolved - The resolved path of the field.
   * @param operator - The operator.
   * @param operand - The operand.
   * @param siblings - The whole operator object (`$options` needs `$regex`).
   * @param mode - `cast` or `encode`.
   * @param path - Where the operand sits, for errors.
   * @returns The cast or encoded operand.
   * @throws {PolicyError} When the operator is unknown or does not apply to the field.
   * @throws {CastError} When the operand has the wrong shape or type.
   */
  private static operator(
    resolved: ResolvedPath,
    operator: string,
    operand: unknown,
    siblings: Readonly<Record<string, unknown>>,
    mode: FilterMode,
    path: string,
  ): unknown {
    const node = resolved.node;
    if (COMPARISON.has(operator)) return FilterCodec.equality(node, operand, resolved.nullable, mode, path);
    if (operator === "$in" || operator === "$nin") {
      if (!Array.isArray(operand)) return castFail(path, operand, "Array", `${operator} takes an array`);
      return Object.freeze(
        operand.map((item: unknown, index) =>
          FilterCodec.equality(node, item, resolved.nullable, mode, join(path, String(index))),
        ),
      );
    }
    if (operator === "$exists") {
      if (typeof operand !== "boolean") return castFail(path, operand, "boolean", "$exists takes true or false");
      return operand;
    }
    if (operator === "$type") return FilterCodec.typeOperand(operand, path);
    if (operator === "$regex") {
      if (!scalarTypesOf(node).includes("string")) {
        throw PolicyErrors.strict("sanitize", `$regex applies to strings only (at "${path}")`, path);
      }
      if (typeof operand === "string") return operand;
      if (isRegex(operand)) return FilterCodec.regex(operand, mode, path);
      return castFail(path, operand, "string | RegExp", "$regex takes a pattern");
    }
    if (operator === "$options") {
      if (!("$regex" in siblings))
        throw PolicyErrors.strict("sanitize", `$options without $regex (at "${path}")`, path);
      if (typeof operand !== "string" || !REGEX_OPTIONS.test(operand)) {
        return castFail(path, operand, "regex options", "$options takes the flags i, m, x, s, u");
      }
      return operand;
    }
    if (operator === "$not") {
      if (isRegex(operand)) return FilterCodec.regex(operand, mode, path);
      if (!isOperatorObject(operand)) {
        throw PolicyErrors.strict("sanitize", `$not takes an object of operators or a regex (at "${path}")`, path);
      }
      return FilterCodec.condition(resolved, operand, mode, path);
    }
    if (operator === "$mod") {
      FilterCodec.requireTypes(node, INTEGER_TYPES, operator, path);
      if (
        !Array.isArray(operand) ||
        operand.length !== 2 ||
        !operand.every((n: unknown) => typeof n === "number" && Number.isInteger(n))
      ) {
        return castFail(path, operand, "[divisor, remainder]", "$mod takes two integers");
      }
      if (operand[0] === 0) return castFail(path, operand, "[divisor, remainder]", "$mod by 0");
      return Object.freeze([...operand]);
    }
    if (BITS.has(operator)) return FilterCodec.bits(node, operator, operand, path);
    if (operator === "$size") {
      if (node.kind !== "array") throw PolicyErrors.strict("sanitize", `$size applies to arrays (at "${path}")`, path);
      if (!Number.isInteger(operand) || (operand as number) < 0) {
        return castFail(path, operand, "non-negative integer", "$size takes an array length");
      }
      return operand;
    }
    if (operator === "$all") {
      if (node.kind !== "array") throw PolicyErrors.strict("sanitize", `$all applies to arrays (at "${path}")`, path);
      if (!Array.isArray(operand)) return castFail(path, operand, "Array", "$all takes an array");
      return Object.freeze(
        operand.map((item: unknown, index) => {
          const at = join(path, String(index));
          if (BsonGuards.isPlainObject(item) && Object.keys(item).length === 1 && "$elemMatch" in item) {
            return Object.freeze({
              $elemMatch: FilterCodec.elemMatch(node, item.$elemMatch, mode, join(at, "$elemMatch")),
            });
          }
          return FilterCodec.equality(node, item, resolved.nullable, mode, at);
        }),
      );
    }
    if (operator === "$elemMatch") {
      if (node.kind !== "array") {
        throw PolicyErrors.strict("sanitize", `$elemMatch applies to arrays (at "${path}")`, path);
      }
      return FilterCodec.elemMatch(node, operand, mode, path);
    }
    if (GEO.has(operator)) return FilterCodec.geo(operand, path);
    throw PolicyErrors.strict("sanitize", `"${operator}" is not a query operator of a field (at "${path}")`, path);
  }

  /**
   * The operand of `$elemMatch`: a filter of the element documents, or a condition on scalar elements.
   *
   * @param node - The array node.
   * @param operand - The operand.
   * @param mode - `cast` or `encode`.
   * @param path - Where the operand sits, for errors.
   * @returns The cast or encoded operand.
   * @throws {PolicyError} When the operand is not a non-empty object.
   */
  private static elemMatch(
    node: Extract<PathNode, { kind: "array" }>,
    operand: unknown,
    mode: FilterMode,
    path: string,
  ): unknown {
    if (!BsonGuards.isPlainObject(operand) || Object.keys(operand).length === 0) {
      throw PolicyErrors.strict("sanitize", `$elemMatch takes a non-empty object (at "${path}")`, path);
    }
    const element = node.element;
    const documentElement = element.kind === "subdocument" || element.kind === "nested";
    const logicalOrFields = Object.keys(operand).some((key) => !key.startsWith("$") || LOGICAL.has(key));
    if (documentElement && logicalOrFields) return FilterCodec.walk(operand, element, mode, path);
    const resolved: ResolvedPath = {
      node: element,
      path,
      dbPath: path,
      nullable: element.nullable,
      identifiers: new Map(),
    };
    return FilterCodec.condition(resolved, operand, mode, path);
  }

  /**
   * The operand of `$type`: a BSON type alias or number, or a non-empty list of them.
   *
   * @param operand - The operand.
   * @param path - Where the operand sits, for errors.
   * @returns The operand (a list is copied and frozen).
   * @throws {CastError} When the operand is not a valid type.
   */
  private static typeOperand(operand: unknown, path: string): unknown {
    const valid = (item: unknown): boolean =>
      (typeof item === "string" && TYPE_ALIASES.has(item)) || (Number.isInteger(item) && (item as number) >= -1);
    if (Array.isArray(operand) ? operand.length > 0 && operand.every(valid) : valid(operand)) {
      return Array.isArray(operand) ? Object.freeze([...operand]) : operand;
    }
    return castFail(path, operand, "BSON type alias", "$type takes a BSON type alias or number (or a list of them)");
  }

  /**
   * The operand of a bit operator: a bitmask integer, a list of bit positions, or a `Binary`.
   *
   * @param node - The path node.
   * @param operator - The bit operator.
   * @param operand - The operand.
   * @param path - Where the operand sits, for errors.
   * @returns The operand (a list is copied and frozen).
   * @throws {PolicyError} When the field is neither an integer nor binary.
   * @throws {CastError} When the operand is not a bitmask.
   */
  private static bits(node: PathNode, operator: string, operand: unknown, path: string): unknown {
    const types = scalarTypesOf(node);
    if (!types.some((type) => INTEGER_TYPES.has(type) || type === "binary")) {
      throw PolicyErrors.strict("sanitize", `${operator} applies to integer or binary fields (at "${path}")`, path);
    }
    const position = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 0;
    if (position(operand) || BsonGuards.isBinary(operand)) return operand;
    if (Array.isArray(operand) && operand.every(position)) return Object.freeze([...operand]);
    return castFail(
      path,
      operand,
      "bitmask",
      `${operator} takes a non-negative integer, a list of bit positions or a Binary`,
    );
  }

  /**
   * A geo operand: GeoJSON or legacy shapes whose numbers are finite numbers (no strings, Mongoose H026).
   *
   * @param operand - The operand.
   * @param path - Where the operand sits, for errors.
   * @returns The operand, unchanged.
   * @throws {CastError} When a coordinate is not a finite number or a value is not GeoJSON.
   */
  private static geo(operand: unknown, path: string): unknown {
    const check = (value: unknown, at: string): void => {
      if (typeof value === "number") {
        if (!Number.isFinite(value)) castFail(at, value, "number", "a coordinate is a finite number");
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item: unknown, index) => {
          check(item, join(at, String(index)));
        });
        return;
      }
      if (BsonGuards.isPlainObject(value)) {
        for (const [key, item] of Object.entries(value)) {
          if (key === "type" || key === "crs") continue;
          check(item, join(at, key));
        }
        return;
      }
      if (typeof value === "string" && at.endsWith(".type")) return;
      castFail(at, value, "GeoJSON", "a geo operand holds numbers, arrays of numbers and GeoJSON objects");
    };
    check(operand, path);
    return operand;
  }

  /**
   * Requires the field to store a scalar of one of the allowed types.
   *
   * @param node - The path node.
   * @param allowed - The allowed scalar types.
   * @param operator - The operator, for the error.
   * @param path - Where the operand sits, for the error.
   * @throws {PolicyError} When the field stores none of the allowed types.
   */
  private static requireTypes(node: PathNode, allowed: ReadonlySet<string>, operator: string, path: string): void {
    if (!scalarTypesOf(node).some((type) => allowed.has(type))) {
      throw PolicyErrors.strict("sanitize", `${operator} does not apply to "${node.path}" (at "${path}")`, path);
    }
  }

  /**
   * `$expr` in database names: field references of the document translated (Mongoose H14).
   *
   * @param expression - The compiled `$expr` operand.
   * @param root - A document schema, or an element node.
   * @returns The expression with field references in database names.
   */
  private static expression(expression: unknown, root: ResolveRoot): unknown {
    return ExpressionPaths.map(expression, (fieldPath) => {
      const resolution = PathResolver.resolve(root, fieldPath, "read");
      return resolution.ok ? resolution.value.dbPath : undefined;
    });
  }

  /**
   * The filter of a document schema, cast.
   *
   * @param schema - The compiled schema.
   * @param filter - The filter.
   * @returns The cast filter, in code names.
   * @throws {PolicyError} On an empty logical list, an unknown operator or path, or `undefined`.
   * @throws {CastError} When a value does not fit its field.
   */
  static cast(schema: CompiledSchema, filter: PlanDocument): PlanDocument {
    return FilterCodec.walk(filter, schema, "cast");
  }

  /**
   * The cast filter of a document schema in wire form (database names, BSON wrappers).
   *
   * @param schema - The compiled schema.
   * @param filter - The cast filter.
   * @returns The encoded filter.
   * @throws {PolicyError} On an empty logical list, an unknown operator or path, or `undefined`.
   */
  static encode(schema: CompiledSchema, filter: PlanDocument): PlanDocument {
    return FilterCodec.walk(filter, schema, "encode");
  }
}
