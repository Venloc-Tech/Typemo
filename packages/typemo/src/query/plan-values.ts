import { ExprCompiler, type ExprOver } from "../aggregate/expressions/public.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import { QueryError } from "../errors/query-error.ts";
import type { PlanDocument } from "./plan.ts";

/*
 * Copies of the user's input for a plan (input is never mutated, never aliased). Plain
 * objects and arrays are copied and frozen; a `Date` is copied; BSON values, `RegExp` and binary views
 * are kept (they are values). `undefined` anywhere is refused (the driver sends it as `null`, so
 * `{ token: undefined }` would silently match documents WITHOUT a token). A function is
 * refused too: the only callback a filter may hold is `$expr`, compiled before the copy.
 */

/** The logical operators whose operand is a non-empty list of filters. */
const LOGICAL = new Set(["$and", "$or", "$nor"]);

/**
 * Appends `key` to a dotted path.
 *
 * @param base - The path so far; empty for the root.
 * @param key - The key to append.
 * @returns The extended path.
 */
const pathOf = (base: string, key: string): string => (base === "" ? key : `${base}.${key}`);

/**
 * Deep copies and checks of plan input.
 *
 * @example
 * const filter = PlanValues.filter({ age: { $gt: 18 } }, "find"); // a frozen deep copy
 */
export class PlanValues {
  /**
   * A frozen deep copy of `value`; throws `QueryError` at the first `undefined` or function.
   *
   * @param value - The value to copy.
   * @param path - The path of `value`, for error messages.
   * @param what - The operation name, for error messages.
   * @returns The frozen copy (BSON values and `RegExp` are kept as they are).
   * @throws {QueryError} When `value` holds `undefined` or a function anywhere.
   */
  static copy(value: unknown, path: string, what: string): unknown {
    if (value === undefined) {
      throw new QueryError(
        `${what}: undefined at "${path}" (use $exists: false / $unset; undefined is never a value)`,
        {
          path,
        },
      );
    }
    if (typeof value === "function") {
      throw new QueryError(`${what}: a function at "${path}" is not a value`, { path });
    }
    if (typeof value !== "object" || value === null) return value;
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((item: unknown, index) => PlanValues.copy(item, pathOf(path, String(index)), what)),
      );
    }
    if (BsonGuards.isDate(value)) return new Date(value.getTime());
    if (BsonGuards.isMap(value)) {
      const copy = new Map<unknown, unknown>();
      for (const [key, item] of value) copy.set(key, PlanValues.copy(item, pathOf(path, String(key)), what));
      return copy;
    }
    if (BsonGuards.isOpaqueValue(value) || !BsonGuards.isPlainObject(value)) return value;
    return PlanValues.copyObject(value, path, what);
  }

  /**
   * A frozen copy of a plain object (own enumerable string keys; `__proto__` stays a plain key).
   *
   * @param value - The object to copy.
   * @param path - The path of `value`, for error messages.
   * @param what - The operation name, for error messages.
   * @returns The frozen copy.
   * @throws {QueryError} When a value inside holds `undefined` or a function.
   */
  static copyObject(value: Readonly<Record<string, unknown>>, path: string, what: string): PlanDocument {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(out, key, {
        value: PlanValues.copy(value[key], pathOf(path, key), what),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return Object.freeze(out);
  }

  /**
   * A filter copy: `$expr` callbacks compiled into expressions (`ExprCompiler.compileExpr`) at the
   * root and inside `$and`/`$or`/`$nor`; empty `$and`/`$or`/`$nor` refused at any level (the server refuses
   * them too). The copy is made here, key by key, so a `__proto__` key stays a key.
   *
   * @param filter - The user's filter.
   * @param what - The operation name, for error messages.
   * @param path - The path of `filter`, for error messages.
   * @returns The frozen copy.
   * @throws {QueryError} On `undefined`, a function, a `$expr` that is not a callback, or an empty logical list.
   */
  static filter(filter: Readonly<Record<string, unknown>>, what: string, path = ""): PlanDocument {
    PlanValues.checkLogical(filter, path, what);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(filter)) {
      const value = filter[key];
      const at = pathOf(path, key);
      let copied: unknown;
      if (key === "$expr") {
        if (typeof value !== "function") {
          throw new QueryError(`${what}: $expr is a callback (f) => fn.… (a raw $expr object is not typed)`, {
            path: at,
          });
        }
        copied = PlanValues.copy(ExprCompiler.compileExpr(value as ExprOver<unknown>), at, what);
      } else if (LOGICAL.has(key) && Array.isArray(value)) {
        copied = Object.freeze(
          value.map((clause: unknown, index) =>
            BsonGuards.isPlainObject(clause)
              ? PlanValues.filter(clause, what, pathOf(at, String(index)))
              : PlanValues.copy(clause, pathOf(at, String(index)), what),
          ),
        );
      } else {
        copied = PlanValues.copy(value, at, what);
      }
      Object.defineProperty(out, key, { value: copied, enumerable: true, writable: true, configurable: true });
    }
    return Object.freeze(out);
  }

  /**
   * Refuses an empty or non-array `$and`/`$or`/`$nor` at any depth.
   *
   * @param node - The filter (or a part of it) to walk.
   * @param path - The path of `node`, for error messages.
   * @param what - The operation name, for error messages.
   * @throws {QueryError} When a logical operator does not hold a non-empty array.
   */
  private static checkLogical(node: unknown, path: string, what: string): void {
    if (typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) {
      node.forEach((item: unknown, index) => {
        PlanValues.checkLogical(item, pathOf(path, String(index)), what);
      });
      return;
    }
    if (!BsonGuards.isPlainObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (LOGICAL.has(key) && (!Array.isArray(value) || value.length === 0)) {
        throw new QueryError(`${what}: ${key} must be a non-empty array (at "${pathOf(path, key)}")`, {
          path: pathOf(path, key),
        });
      }
      PlanValues.checkLogical(value, pathOf(path, key), what);
    }
  }

  /**
   * Combines filter clauses: disjoint ones are merged into one object, overlapping ones go into `$and`.
   *
   * @param clauses - The filters to combine; empty ones are dropped.
   * @returns One frozen filter that matches what all the clauses match.
   */
  static combine(clauses: readonly PlanDocument[]): PlanDocument {
    const nonEmpty = clauses.filter((clause) => Object.keys(clause).length > 0);
    const [first, ...rest] = nonEmpty;
    if (first === undefined) return Object.freeze({});
    const merged: Record<string, unknown> = { ...first };
    const extra: PlanDocument[] = [];
    for (const clause of rest) {
      if (Object.keys(clause).some((key) => key in merged)) extra.push(clause);
      else
        for (const key of Object.keys(clause))
          Object.defineProperty(merged, key, {
            value: clause[key],
            enumerable: true,
            writable: true,
            configurable: true,
          });
    }
    return Object.freeze(extra.length === 0 ? merged : { $and: Object.freeze([Object.freeze(merged), ...extra]) });
  }
}
