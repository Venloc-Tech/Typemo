import { SortSpecs } from "../aggregate/expressions/sort-spec.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import { CastError } from "../errors/cast-error.ts";
import { QueryError } from "../errors/query-error.ts";
import type { ExplainVerbosity } from "../types/result.ts";
import type { PlanDocument, SortPair } from "./plan.ts";
import { PlanValues } from "./plan-values.ts";

/* Checks of the small query settings that need no schema: sort, skip/limit, hint, timeouts, batch size. */

/**
 * `true` for an integer that is zero or greater.
 *
 * @param value - The value to test.
 * @returns Whether `value` is a non-negative integer.
 */
const isNonNegativeInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/**
 * Validation and normalization of query settings.
 *
 * @example
 * QuerySpecs.sort({ age: -1, name: "asc" }); // [["age", -1], ["name", 1]]
 */
export class QuerySpecs {
  /**
   * A sort object or a list of pairs → an ordered list of pairs; directions `1`/`-1` or words, normalized to
   * `1`/`-1` (Mongoose H18).
   *
   * @param sort - A sort object, or a list of `[path, direction]` pairs.
   * @returns The frozen, ordered pairs.
   * @throws {QueryError} When the shape is wrong, a path is empty or sorted twice, or a direction is unknown.
   */
  static sort(sort: unknown): readonly SortPair[] {
    const pairs: readonly (readonly [unknown, unknown])[] = Array.isArray(sort)
      ? sort.map((pair: unknown) => {
          if (!Array.isArray(pair) || pair.length !== 2)
            throw new QueryError("sort: a list entry must be a [path, direction] pair");
          return [pair[0], pair[1]] as const;
        })
      : BsonGuards.isPlainObject(sort)
        ? Object.entries(sort)
        : [];
    if (!Array.isArray(sort) && !BsonGuards.isPlainObject(sort))
      throw new QueryError("sort: an object or a list of pairs");
    const seen = new Set<string>();
    return Object.freeze(
      pairs.map(([path, direction]) => {
        if (typeof path !== "string" || path === "") throw new QueryError("sort: a path must be a non-empty string");
        const normalized = SortSpecs.directionOf(direction);
        if (normalized === undefined) {
          throw new QueryError(
            `sort: the direction of "${path}" must be 1, -1, "asc", "desc", "ascending" or "descending"`,
            { path },
          );
        }
        if (seen.has(path)) throw new QueryError(`sort: "${path}" is sorted twice`, { path });
        seen.add(path);
        return Object.freeze([path, normalized] as const);
      }),
    );
  }

  /**
   * Appends sort pairs; a path sorted twice is an error (Mongoose silently kept the first position).
   *
   * @param previous - The pairs so far, if any.
   * @param next - The pairs to append.
   * @returns The frozen list of all pairs.
   * @throws {QueryError} When a path would be sorted twice.
   */
  static appendSort(previous: readonly SortPair[] | undefined, next: readonly SortPair[]): readonly SortPair[] {
    const all = [...(previous ?? []), ...next];
    const paths = all.map(([path]) => path);
    const twice = paths.find((path, index) => paths.indexOf(path) !== index);
    if (twice !== undefined) throw new QueryError(`sort: "${twice}" is sorted twice`, { path: twice });
    return Object.freeze(all);
  }

  /**
   * `limit`: a positive integer (`limit(0)` means "no limit" to the driver: refused, write no limit instead).
   *
   * @param value - The limit.
   * @returns `value`, when valid.
   * @throws {QueryError} When `value` is not a positive integer.
   */
  static limit(value: unknown): number {
    if (!Number.isInteger(value) || (value as number) <= 0)
      throw new QueryError(`limit must be a positive integer, got ${CastError.describe(value)}`);
    return value as number;
  }

  /**
   * `skip`: a non-negative integer.
   *
   * @param what - The setting name, used in the error message.
   * @param value - The value.
   * @returns `value`, when valid.
   * @throws {QueryError} When `value` is not a non-negative integer.
   */
  static count(what: string, value: unknown): number {
    if (!isNonNegativeInteger(value))
      throw new QueryError(`${what} must be a non-negative integer, got ${CastError.describe(value)}`);
    return value;
  }

  /**
   * `batchSize` (and other sizes where the driver reads `0` as "the server default"): a positive integer.
   * `0` is refused so it cannot silently mean something other than zero; leave the setting out for the default.
   *
   * @param what - The setting name, used in the error message.
   * @param value - The value.
   * @returns `value`, when valid.
   * @throws {QueryError} When `value` is not a positive integer.
   */
  static positive(what: string, value: unknown): number {
    if (!Number.isInteger(value) || (value as number) <= 0) {
      const zero =
        value === 0 ? ` (the driver reads 0 as "the server default"; leave ${what} out for the default)` : "";
      throw new QueryError(`${what} must be a positive integer, got ${CastError.describe(value)}${zero}`);
    }
    return value as number;
  }

  /**
   * `timeoutMS`: a non-negative integer (`0` = no timeout, driver CSOT).
   *
   * @param value - The timeout in milliseconds.
   * @returns `value`, when valid.
   * @throws {QueryError} When `value` is not a non-negative integer.
   */
  static timeoutMS(value: unknown): number {
    return QuerySpecs.count("timeoutMS", value);
  }

  /**
   * `explain` verbosity: one of the three levels the server knows.
   *
   * @param value - The verbosity.
   * @returns `value`, when valid.
   * @throws {QueryError} When `value` is not `queryPlanner`, `executionStats` or `allPlansExecution`.
   */
  static explainVerbosity(value: unknown): ExplainVerbosity {
    if (value === "queryPlanner" || value === "executionStats" || value === "allPlansExecution") return value;
    throw new QueryError(
      `explain: the verbosity is "queryPlanner", "executionStats" or "allPlansExecution" (got ${JSON.stringify(value) ?? String(value)})`,
    );
  }

  /**
   * `hint`: an index name or a key pattern.
   *
   * @param hint - The index name or key pattern.
   * @returns The name, or a frozen copy of the key pattern.
   * @throws {QueryError} When `hint` is neither a non-empty name nor a non-empty key pattern.
   */
  static hint(hint: unknown): string | PlanDocument {
    if (typeof hint === "string" && hint !== "") return hint;
    if (BsonGuards.isPlainObject(hint) && Object.keys(hint).length > 0) return PlanValues.copyObject(hint, "", "hint");
    throw new QueryError("hint: an index name or a non-empty key pattern");
  }
}
