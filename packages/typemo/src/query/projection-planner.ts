import { BsonGuards } from "../bson/bson-guards.ts";
import { QueryError } from "../errors/query-error.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PlanDocument } from "./plan.ts";
import { PlanValues } from "./plan-values.ts";

/*
 * The runtime twin of `types/projection.ts`: checks a projection when the builder gets it, merges
 * repeated `select()` calls, and computes the projection the server receives (`effective`: the default
 * exclusion of `Hidden` fields, `+field` additions). `effective` needs the compiled schema, so the
 * operation pipeline calls it; a test plan runner can do the same.
 */

/**
 * What a projection does to the fields it does not name: `include` keeps only the named ones, `exclude`
 * drops the named ones, `neutral` names none.
 *
 * @example
 * const mode: Mode = "include";
 */
type Mode = "include" | "exclude" | "neutral";

/**
 * `true` for `1` and `true`.
 *
 * @param value - The flag.
 * @returns Whether the flag includes a field.
 */
const isTruthyFlag = (value: unknown): boolean => value === 1 || value === true;
/**
 * `true` for `0` and `false`.
 *
 * @param value - The flag.
 * @returns Whether the flag excludes a field.
 */
const isFalsyFlag = (value: unknown): boolean => value === 0 || value === false;

/**
 * `true` for a plain object that has `key`.
 *
 * @param value - The value to test.
 * @param key - The key to look for.
 * @returns Whether `value` is a plain object with `key`.
 */
const hasKey = (value: unknown, key: string): boolean => BsonGuards.isPlainObject(value) && key in value;

/**
 * Checks, merges and completes projections.
 *
 * @example
 * ProjectionPlanner.check({ name: 1, age: 1 }); // a frozen copy
 * ProjectionPlanner.check({ name: 1, age: 0 }); // throws QueryError: cannot mix inclusion and exclusion
 */
export class ProjectionPlanner {
  /**
   * The mode of one entry: `1`/`true`/`$elemMatch` include, `0`/`false` exclude, `$slice`/`$meta` neither.
   *
   * @param key - The projected path (or a `+path` addition).
   * @param value - The flag or operator object.
   * @returns The mode of the entry.
   * @throws {QueryError} When a `+path` is not `true` or the value is not a flag, `$slice` or `$elemMatch`.
   */
  static modeOf(key: string, value: unknown): Mode {
    if (key.startsWith("+")) {
      if (value !== true) throw new QueryError(`projection: "${key}" takes only true`, { path: key });
      return "neutral";
    }
    if (isTruthyFlag(value) || hasKey(value, "$elemMatch")) return "include";
    if (isFalsyFlag(value)) return "exclude";
    if (hasKey(value, "$slice") || hasKey(value, "$meta")) return "neutral";
    throw new QueryError(`projection: the value of "${key}" must be 0, 1, true, false, $slice or $elemMatch`, {
      path: key,
    });
  }

  /**
   * A frozen copy of `projection`; throws `QueryError` when it mixes inclusion and exclusion (except `_id`).
   *
   * @param projection - The user's projection.
   * @returns The frozen copy.
   * @throws {QueryError} When entries are invalid or mix inclusion and exclusion.
   */
  static check(projection: Readonly<Record<string, unknown>>): PlanDocument {
    const copy = PlanValues.copyObject(projection, "", "projection");
    ProjectionPlanner.modeOfProjection(copy);
    return copy;
  }

  /**
   * The mode of a whole projection (`_id` does not count).
   *
   * @param projection - The projection.
   * @returns `include`, `exclude`, or `neutral` when nothing but `$slice`/`$meta` is named.
   * @throws {QueryError} When entries are invalid or mix inclusion and exclusion.
   */
  static modeOfProjection(projection: PlanDocument): Mode {
    const included: string[] = [];
    const excluded: string[] = [];
    for (const [key, value] of Object.entries(projection)) {
      const mode = ProjectionPlanner.modeOf(key, value);
      if (key === "_id") continue;
      if (mode === "include") included.push(key);
      if (mode === "exclude") excluded.push(key);
    }
    if (included.length > 0 && excluded.length > 0) {
      throw new QueryError(
        `projection: cannot mix inclusion (${included.join(", ")}) and exclusion (${excluded.join(", ")}); the server refuses it`,
      );
    }
    if (included.length > 0) return "include";
    if (excluded.length > 0) return "exclude";
    /* `{ _id: 1 }` alone is an inclusion of `_id` only (the server returns nothing else). */
    const id = projection._id;
    return id === 1 || id === true ? "include" : "neutral";
  }

  /**
   * `select(a).select(b)`: one projection; a key named twice or a mode conflict is an error.
   *
   * @param previous - The projection so far, if any.
   * @param next - The projection to add.
   * @returns The merged, frozen projection.
   * @throws {QueryError} When a key is selected twice or the merge mixes inclusion and exclusion.
   */
  static merge(previous: PlanDocument | undefined, next: PlanDocument): PlanDocument {
    if (previous === undefined) return next;
    for (const key of Object.keys(next)) {
      if (key in previous) throw new QueryError(`projection: "${key}" is selected twice`, { path: key });
    }
    const merged = Object.freeze({ ...previous, ...next });
    ProjectionPlanner.modeOfProjection(merged);
    return merged;
  }

  /**
   * Code paths of the `hidden` fields of a schema, outermost only (`$` elements dropped, Map values skipped).
   *
   * @param schema - The compiled schema.
   * @returns The paths of the hidden fields that are not inside another hidden field.
   */
  static hiddenPaths(schema: CompiledSchema): readonly string[] {
    const paths = Object.values(schema.allPaths)
      .filter((node) => node.hidden && !node.path.includes("$*"))
      .map((node) => node.path.replaceAll(".$", ""));
    return paths.filter((path) => !paths.some((other) => other !== path && path.startsWith(`${other}.`)));
  }

  /**
   * The projection sent to the server: the user's projection with `+field` keys resolved and, unless it
   * is an inclusion, every `hidden` field excluded (except those added with `+`). `undefined` when
   * nothing is to be projected.
   *
   * @param schema - The compiled schema.
   * @param projection - The user's projection, if any.
   * @returns The projection to send, or `undefined`.
   * @throws {QueryError} When the user's projection is invalid.
   */
  static effective(schema: CompiledSchema, projection: PlanDocument | undefined): PlanDocument | undefined {
    const entries = Object.entries(projection ?? {});
    const plus = new Set(entries.filter(([key]) => key.startsWith("+")).map(([key]) => key.slice(1)));
    const own = entries.filter(([key]) => !key.startsWith("+"));
    const mode = ProjectionPlanner.modeOfProjection(Object.fromEntries(own));
    const out: Record<string, unknown> = Object.fromEntries(own);
    if (mode === "include") {
      for (const path of plus) out[path] = 1;
    } else {
      const excludedByUser = own.filter(([, value]) => isFalsyFlag(value)).map(([key]) => key);
      for (const path of ProjectionPlanner.hiddenPaths(schema)) {
        if (plus.has(path)) continue;
        if (excludedByUser.some((key) => path === key || path.startsWith(`${key}.`))) continue;
        out[path] = 0;
      }
    }
    return Object.keys(out).length === 0 ? undefined : Object.freeze(out);
  }
}
