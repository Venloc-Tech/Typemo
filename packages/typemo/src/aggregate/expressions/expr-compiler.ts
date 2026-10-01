import { ConfigurationError } from "../../errors/configuration-error.ts";
import { SafeRecord } from "../../internal/safe-record.ts";
import type { PipelineDoc } from "../types/doc-shape.ts";
import { type ExprNode, ExprNodes } from "./expr-node.ts";
import { FieldProxies, type FieldProxy } from "./field-proxy.ts";

/*
 * The `$expr` contract with the query layer: a filter's `$expr` is written as a callback over the document's
 * field references and must yield a boolean-valued EXPRESSION (not an accumulator, not a window function):
 *
 *   Model.find({ $expr: (f) => fn.gt(f.spent, f.budget) })
 *
 * Literals are not cast against the schema: they go to the server as written.
 */

/**
 * A boolean-valued expression: a node of a boolean (possibly `null`/missing) value, or a literal.
 *
 * @example
 * ```ts
 * const a: BooleanExpr = true;
 * const b: BooleanExpr = fn.gt(f.spent, f.budget);
 * // @ts-expect-error a string is not a boolean expression
 * const c: BooleanExpr = "yes";
 * ```
 */
export type BooleanExpr = ExprNode<boolean | null | undefined> | boolean;

/**
 * The value of `$expr` in a filter over an entity (or any document type) `T`: a callback that receives
 * `f`, the field references of the stored form of `T` (`PipelineDoc<T>`: data only, markers removed).
 * Lazy: nothing about `T` is computed until a callback is actually checked against it.
 * `PipelineDoc` is idempotent on a plain document type.
 *
 * @typeParam T - The entity or document type.
 * @example
 * ```ts
 * interface Budget {
 *   spent: number;
 *   budget: number;
 * }
 * const expr: ExprFor<Budget> = (f) => fn.gt(f.spent, f.budget);
 * ```
 */
export type ExprFor<T> = ExprOver<PipelineDoc<T>>;

/**
 * The same callback over a document type used as is (pipeline stages, where the shape is already plain).
 *
 * @typeParam Doc - The plain document type.
 * @example
 * ```ts
 * const expr: ExprOver<{ spent: number; budget: number }> = (f) => fn.gt(f.spent, f.budget);
 * ```
 */
export type ExprOver<Doc> = (f: FieldProxy<Doc>) => BooleanExpr;

/** An object literal filter (or a branch of `$and`/`$or`/`$nor`). */
type FilterNode = Readonly<Record<string, unknown>>;

/**
 * Whether a value is an object literal (not an array, class instance or `null`).
 *
 * @param value - The value to test.
 * @returns `true` for an object with `Object.prototype` as prototype.
 */
const isRecord = (value: unknown): value is FilterNode =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/** Serializes `$expr` callbacks. Pure: the input filter is never mutated. */
export class ExprCompiler {
  /**
   * The MongoDB value of one `$expr` callback.
   *
   * @typeParam Doc - The plain document type the callback reads.
   * @param expr - The callback.
   * @returns The serialized expression.
   */
  static compileExpr<Doc>(expr: ExprOver<Doc>): unknown {
    return ExprNodes.serialize(expr(FieldProxies.root<Doc>()));
  }

  /**
   * A copy of `filter` where every `$expr` callback (at the top level and inside `$and`/`$or`/`$nor`)
   * is replaced by its serialized expression. Everything else is copied as is. `$expr` must be a
   * callback: a raw object there is rejected (it would skip every check this layer makes).
   *
   * @param filter - The filter to resolve; never mutated.
   * @returns A new filter with serialized `$expr` values.
   * @throws {ConfigurationError} When a `$expr` value is not a function.
   */
  static resolveFilter(filter: FilterNode): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filter)) {
      if (key === "$expr") {
        if (typeof value !== "function") {
          throw new ConfigurationError("$expr must be a callback (f) => fn.…: a raw $expr object is not typed");
        }
        SafeRecord.set(out, key, ExprCompiler.compileExpr(value as ExprOver<unknown>));
      } else if ((key === "$and" || key === "$or" || key === "$nor") && Array.isArray(value)) {
        SafeRecord.set(
          out,
          key,
          value.map((branch: unknown) => (isRecord(branch) ? ExprCompiler.resolveFilter(branch) : branch)),
        );
      } else {
        SafeRecord.set(out, key, value);
      }
    }
    return out;
  }
}
