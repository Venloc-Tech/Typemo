import { ConfigurationError } from "../../errors/configuration-error.ts";
import { SafeRecord } from "../../internal/safe-record.ts";
import type { DocPaths } from "../types/path-types.ts";
import { ExprNodes, type SomeExprNode } from "./expr-node.ts";
import type { FieldPath } from "./field-proxy.ts";

/*
 * Sort specifications inside expressions and stages.
 *
 * - Stages (`$sort`, `$setWindowFields.sortBy`, `$fill.sortBy`) and `$sortArray` take the object form
 *   over the paths of the document they sort: `{ "address.city": 1, age: -1 }` (`SortSpecOf<T>`).
 * - Accumulators with a sort (`$top`, `$bottom`, `$topN`, `$bottomN`) are built inside a callback and do
 *   not know the document type, so they take FIELD REFERENCES: `sortBy: [[f.score, -1], [f.name, 1]]`.
 *   A typo is an ordinary property error, and only a reference to a field (`FieldPath`, which `f.x`
 *   has and a computed `fn.add(...)` or a `$$variable` has not) is accepted.
 * - H18: every direction may also be a word — `"asc"`/`"ascending"` (= 1), `"desc"`/`"descending"`
 *   (= -1), as in Mongoose. The builder writes `1`/`-1` into the stage: the server never sees a word.
 */

/**
 * Ascending / descending, as the server receives it.
 *
 * @example
 * ```ts
 * const order: SortOrder = -1;
 * ```
 */
export type SortOrder = 1 | -1;

/**
 * The words a sort direction may be written with instead of `1`/`-1`, lower case only.
 *
 * @example
 * ```ts
 * const word: SortWord = "desc";
 * ```
 */
export type SortWord = "asc" | "desc" | "ascending" | "descending";

/**
 * A sort direction as the user writes it: `1`/`-1` or a word (`"asc"`, `"descending"`, …). Normalized to {@link SortOrder}.
 *
 * @example
 * ```ts
 * const directions: SortDirectionInput[] = [1, -1, "asc", "descending"];
 * ```
 */
export type SortDirectionInput = SortOrder | SortWord;

/**
 * The object form of a sort over the read paths of `T`.
 *
 * @typeParam T - The document type being sorted.
 * @example
 * ```ts
 * const spec: SortSpecOf<{ age: number; address: { city: string } }> = { "address.city": 1, age: "desc" };
 * ```
 */
export type SortSpecOf<T> = { readonly [P in DocPaths<T>]?: SortDirectionInput };

/**
 * One `[field, order]` pair of an accumulator's `sortBy`.
 *
 * @example
 * ```ts
 * const key: SortKey = [f.score, -1];
 * ```
 */
export type SortKey = readonly [FieldPath & SomeExprNode, SortDirectionInput];

/**
 * An accumulator's `sortBy`: one or more `[field, order]` pairs (the order of the pairs is the sort priority).
 *
 * @example
 * ```ts
 * const keys: SortKeys = [[f.score, -1], [f.name, "asc"]];
 * ```
 */
export type SortKeys = readonly [SortKey, ...SortKey[]];

/** The direction words and the numbers they stand for. */
const WORDS: Readonly<Record<SortWord, SortOrder>> = Object.freeze({
  asc: 1,
  ascending: 1,
  desc: -1,
  descending: -1,
});

/** Normalization of sort specifications. */
export class SortSpecs {
  /**
   * `1`/`-1`/a word → `1`/`-1`; anything else is `undefined` (the caller reports it).
   *
   * @param value - The direction as the user wrote it.
   * @returns `1` or `-1`, or `undefined` when the value is not a direction.
   */
  static directionOf(value: unknown): SortOrder | undefined {
    if (value === 1 || value === -1) return value;
    return typeof value === "string" && Object.hasOwn(WORDS, value) ? WORDS[value as SortWord] : undefined;
  }

  /**
   * A copy of a sort object with every direction normalized to `1`/`-1` (H18); `{ $meta }` scores and
   * other operands are kept as they are.
   *
   * @param spec - The sort object; never mutated.
   * @param where - The stage name, used in the error message.
   * @returns A new sort object.
   * @throws {ConfigurationError} When a direction is neither `1`, `-1` nor one of the words.
   */
  static normalize(spec: Readonly<Record<string, unknown>>, where: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(spec)) {
      if (typeof value === "object" && value !== null) {
        SafeRecord.set(out, path, value);
        continue;
      }
      const direction = SortSpecs.directionOf(value);
      if (direction === undefined) {
        throw new ConfigurationError(
          `${where}: the direction of "${path}" must be 1, -1, "asc", "desc", "ascending" or "descending", got ${JSON.stringify(value)}`,
        );
      }
      SafeRecord.set(out, path, direction);
    }
    return out;
  }

  /**
   * `[[f.a, 1], [f.b.c, "desc"]]` → `{ a: 1, "b.c": -1 }`.
   *
   * @param keys - The `[field, order]` pairs of an accumulator's `sortBy`.
   * @returns The sort object, in the order of the pairs.
   * @throws {ConfigurationError} When a field is not a document field reference or a direction is invalid.
   */
  static fromKeys(keys: SortKeys): Record<string, SortOrder> {
    const out: Record<string, SortOrder> = {};
    for (const [field, order] of keys) {
      const path = ExprNodes.serialize(field);
      if (typeof path !== "string" || !path.startsWith("$") || path.startsWith("$$")) {
        throw new ConfigurationError(`sortBy takes field references (f.field), got ${JSON.stringify(path)}`);
      }
      const direction = SortSpecs.directionOf(order);
      if (direction === undefined) throw new ConfigurationError(`sortBy: invalid direction ${JSON.stringify(order)}`);
      SafeRecord.set(out, path.slice(1), direction);
    }
    return out;
  }
}
