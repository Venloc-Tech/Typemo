import { BsonGuards } from "../../bson/bson-guards.ts";
import { SafeRecord } from "../../internal/safe-record.ts";

/**
 * Maps a field path (without the leading dollar sign) to its replacement.
 *
 * @param path - The field path without the leading dollar sign.
 * @returns The replacement path, or `undefined` to keep it.
 *
 * @example
 * ```ts
 * const map: FieldPathMap = (path) => (path === "city" ? "c" : undefined);
 * ```
 */
export type FieldPathMap = (path: string) => string | undefined;

/**
 * Walks and rewrites field references inside serialized aggregation expressions (`"$profile.city"`), for the
 * `dbName` translation (Mongoose H14) and the operator scan of the sanitize policy. An expression is data: a string
 * that starts with ONE dollar sign in value position is a field path (literal strings that start with a dollar sign
 * are wrapped in `$literal`, so they never look like paths), a double dollar sign starts a variable, and
 * `$literal` operands are data.
 */
export class ExpressionPaths {
  /**
   * A copy of `expression` with every field reference mapped (`$literal` operands untouched).
   *
   * @param expression - The serialized expression.
   * @param map - Maps one field path to its replacement.
   * @returns The rewritten copy.
   */
  static map(expression: unknown, map: FieldPathMap): unknown {
    if (typeof expression === "string") {
      if (!expression.startsWith("$") || expression.startsWith("$$")) return expression;
      const mapped = map(expression.slice(1));
      return mapped === undefined ? expression : `$${mapped}`;
    }
    if (Array.isArray(expression)) return Object.freeze(expression.map((item) => ExpressionPaths.map(item, map)));
    if (!BsonGuards.isPlainObject(expression)) return expression;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(expression)) {
      SafeRecord.set(out, key, key === "$literal" ? value : ExpressionPaths.map(value, map));
    }
    return Object.freeze(out);
  }

  /**
   * Every operator key (`$add`, `$function`, ...) used anywhere in `expression`, outside `$literal`.
   *
   * @param expression - The serialized expression.
   * @param into - The set to add to.
   * @returns `into`.
   */
  static operators(expression: unknown, into: Set<string> = new Set()): Set<string> {
    if (Array.isArray(expression)) {
      for (const item of expression) ExpressionPaths.operators(item, into);
      return into;
    }
    if (!BsonGuards.isPlainObject(expression)) return into;
    for (const [key, value] of Object.entries(expression)) {
      if (key.startsWith("$")) into.add(key);
      if (key !== "$literal") ExpressionPaths.operators(value, into);
    }
    return into;
  }
}
