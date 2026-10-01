import { BsonGuards } from "../bson/bson-guards.ts";

/*
 * The grammar of a query filter, schema-free: which keys are logical clauses, root operators, field
 * paths and field operators. Shared by the policies that look at raw input before the cast (sanitize,
 * empty logical, strict paths) so every one of them sees the SAME filter positions — the history of
 * Mongoose's `sanitizeFilter` is a list of positions one walker forgot (Mongoose H016, H063, H145).
 */

/**
 * Logical clauses of a filter.
 *
 * @example
 * LOGICAL_OPERATORS.has("$or"); // true
 */
export const LOGICAL_OPERATORS: ReadonlySet<string> = new Set(["$and", "$or", "$nor"]);

/**
 * Root operators other than the logical ones. `$where` is not among them (CVE-2025-23061).
 *
 * @example
 * ROOT_OPERATORS.has("$text"); // true
 */
export const ROOT_OPERATORS: ReadonlySet<string> = new Set([
  "$expr",
  "$text",
  "$comment",
  "$jsonSchema",
  "$sampleRate",
]);

/**
 * Geo operators: their operands are objects of `$`-keys (`$geometry`, `$maxDistance`) by design.
 *
 * @example
 * GEO_OPERATORS.has("$near"); // true
 */
export const GEO_OPERATORS: ReadonlySet<string> = new Set([
  "$near",
  "$nearSphere",
  "$geoWithin",
  "$geoIntersects",
  "$maxDistance",
  "$minDistance",
]);

/**
 * Every operator of a field condition.
 *
 * @example
 * FIELD_OPERATORS.has("$gt"); // true
 */
export const FIELD_OPERATORS: ReadonlySet<string> = new Set([
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$exists",
  "$type",
  "$regex",
  "$options",
  "$not",
  "$mod",
  "$bitsAllSet",
  "$bitsAnySet",
  "$bitsAllClear",
  "$bitsAnyClear",
  "$size",
  "$all",
  "$elemMatch",
  ...GEO_OPERATORS,
]);

/**
 * Expression operators that run JavaScript on the server: refused everywhere.
 *
 * @example
 * JAVASCRIPT_OPERATORS.has("$where"); // true
 */
export const JAVASCRIPT_OPERATORS: ReadonlySet<string> = new Set(["$where", "$function", "$accumulator"]);

/**
 * One place of a filter the scan reports.
 *
 * @example
 * const site: FilterSite = { kind: "field", key: "age", value: { $gt: 1 }, path: "age" };
 */
export type FilterSite =
  | { readonly kind: "logical"; readonly key: string; readonly value: unknown; readonly path: string }
  | { readonly kind: "root"; readonly key: string; readonly value: unknown; readonly path: string }
  | { readonly kind: "field"; readonly key: string; readonly value: unknown; readonly path: string }
  | { readonly kind: "operator"; readonly key: string; readonly value: unknown; readonly path: string }
  | { readonly kind: "value"; readonly value: unknown; readonly path: string };

/**
 * Appends `key` to a dotted path.
 *
 * @param base - The path so far; empty for the root.
 * @param key - The key to append.
 * @returns The extended path.
 */
const join = (base: string, key: string): string => (base === "" ? key : `${base}.${key}`);

/**
 * `true` for a plain object with at least one key, all starting with `$`.
 *
 * @param value - The value to test.
 * @returns Whether `value` is an operator object.
 */
export const isOperatorObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  BsonGuards.isPlainObject(value) &&
  Object.keys(value).length > 0 &&
  Object.keys(value).every((key) => key.startsWith("$"));

/**
 * Walks the positions of a raw filter.
 *
 * @example
 * FilterScan.visit({ age: { $gt: 1 } }, (site) => console.log(site.kind, site.path)); // field age, operator age.$gt
 */
export class FilterScan {
  /**
   * Calls `visit` for every position of `filter` (depth first; `$elemMatch` operands included).
   *
   * @param filter - The raw filter; a non-object is reported as one `value` site.
   * @param visit - Called for each site.
   * @param at - The path of `filter`, prepended to every site path.
   */
  static visit(filter: unknown, visit: (site: FilterSite) => void, at = ""): void {
    if (!BsonGuards.isPlainObject(filter)) {
      visit({ kind: "value", value: filter, path: at });
      return;
    }
    for (const [key, value] of Object.entries(filter)) {
      const path = join(at, key);
      if (LOGICAL_OPERATORS.has(key)) {
        visit({ kind: "logical", key, value, path });
        if (Array.isArray(value))
          value.forEach((clause: unknown, index) => {
            FilterScan.visit(clause, visit, join(path, String(index)));
          });
        continue;
      }
      if (key.startsWith("$")) {
        visit({ kind: "root", key, value, path });
        continue;
      }
      visit({ kind: "field", key, value, path });
      if (isOperatorObject(value)) FilterScan.operators(value, visit, path);
    }
  }

  /**
   * The operators of one field condition (recursing into `$not`, `$elemMatch`, `$all`).
   *
   * @param condition - The operator object.
   * @param visit - Called for each site.
   * @param at - The path of the field, prepended to every site path.
   */
  static operators(condition: Readonly<Record<string, unknown>>, visit: (site: FilterSite) => void, at: string): void {
    for (const [key, value] of Object.entries(condition)) {
      const path = join(at, key);
      visit({ kind: "operator", key, value, path });
      if (key === "$not" && isOperatorObject(value)) FilterScan.operators(value, visit, path);
      if (key === "$elemMatch" && BsonGuards.isPlainObject(value)) {
        if (isOperatorObject(value) && !Object.keys(value).some((k) => LOGICAL_OPERATORS.has(k))) {
          FilterScan.operators(value, visit, path);
        } else FilterScan.visit(value, visit, path);
      }
      if (key === "$all" && Array.isArray(value)) {
        value.forEach((item: unknown, index) => {
          if (BsonGuards.isPlainObject(item) && "$elemMatch" in item) {
            FilterScan.operators(item, visit, join(path, String(index)));
          }
        });
      }
    }
  }
}
