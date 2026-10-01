import { type AnyExprNode, type ExprNode, ExprNodes } from "../expr-node.ts";
import type {
  Arg,
  ArgValue,
  MergeObjectsResult,
  Nullable,
  PropagateNull,
  Simplify,
  UnwrapDeep,
} from "../expr-types.ts";
import { FieldProxies, type VarProxy } from "../field-proxy.ts";
import { type Expr, OperatorFactory as F } from "../operator-factory.ts";

/* Object operators and `$let`. */

/**
 * A document argument: an expression or a bare object, possibly `null`/missing.
 *
 * @example
 * ```ts
 * const a: ObjectArg = { a: 1 };
 * const b: ObjectArg = f.address;
 * ```
 */
type ObjectArg = Arg<Nullable<{ readonly [key: string]: unknown }>>;

/**
 * The type of field `K` of `O`; `undefined` when `O` may not have it.
 *
 * @typeParam O - The document type.
 * @typeParam K - The field name.
 * @example
 * ```ts
 * type A = FieldOf<{ a?: number }, "a">; // number | undefined
 * type B = FieldOf<{ a: number }, "b">; // unknown
 * ```
 */
type FieldOf<O, K extends string> = K extends keyof O
  ? O[K] | (object extends Pick<O, K> ? undefined : never)
  : unknown;

/**
 * `$mergeObjects`: 1+ documents merged left to right; ONE argument is also a `$group` accumulator.
 *
 * @example
 * ```ts
 * fn.mergeObjects(f.a, f.b); // Expr<{ … }>
 * fn.mergeObjects(f.a); // usable in `$group` too
 * ```
 */
export interface MergeObjectsOp {
  /**
   * One document; also usable as a `$group` accumulator.
   *
   * @param single - The document.
   * @returns The merged document.
   */
  <const A extends ObjectArg>(single: A): ExprNode<MergeObjectsResult<[A]>, "expr" | "acc">;
  /**
   * Two or more documents merged left to right.
   *
   * @param args - The documents.
   * @returns The merged document.
   */
  <const Args extends readonly [ObjectArg, ObjectArg, ...ObjectArg[]]>(...args: Args): Expr<MergeObjectsResult<Args>>;
}

/** The `$mergeObjects` operator: one argument stays a single value, more are sent as a list. */
const mergeObjects = ((...args: readonly unknown[]): AnyExprNode =>
  F.node(
    "$mergeObjects",
    args.length === 1 ? ExprNodes.serialize(args[0]) : args.map(ExprNodes.serialize),
  )) as MergeObjectsOp;

/** Object operators and `$let`. */
export const objectOps = {
  /**
   * Merges documents (`{ ...a, ...b }`); `null`/missing contributes nothing. With one argument it is
   * also the `$group` accumulator.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/mergeObjects/
   */
  mergeObjects,
  /**
   * A document → `{ k, v }[]`.
   *
   * @param object - The document.
   * @returns The array of key/value pairs, `null` when the document can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/objectToArray/
   */
  objectToArray: <A extends ObjectArg>(
    object: A,
  ): Expr<
    PropagateNull<
      { k: string; v: Exclude<ArgValue<A>, null | undefined>[keyof Exclude<ArgValue<A>, null | undefined>] }[],
      A
    >
  > => F.node("$objectToArray", ExprNodes.serialize(object)),
  /**
   * Reads a field by a constant name (dots and a leading `$` are part of the name).
   *
   * @param spec - The field name and the document to read it from.
   * @returns The field value, `undefined` when the document may not have it.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/getField/
   */
  getField: <const K extends string, I extends ObjectArg>(spec: {
    field: K;
    input: I;
  }): Expr<
    | FieldOf<Exclude<ArgValue<I>, null | undefined>, K>
    | (undefined extends ArgValue<I> ? undefined : never)
    | (null extends ArgValue<I> ? null : never)
  > => F.node("$getField", ExprNodes.spec(spec)),
  /**
   * A copy of a document with one field set.
   *
   * @param spec - The field name, the document and the new value.
   * @returns The document with the field set.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/setField/
   */
  setField: <const K extends string, I extends ObjectArg, const V extends Arg<unknown>>(spec: {
    field: K;
    input: I;
    value: V;
  }): Expr<PropagateNull<Simplify<Omit<Exclude<ArgValue<I>, null | undefined>, K> & { [P in K]: UnwrapDeep<V> }>, I>> =>
    F.node("$setField", ExprNodes.spec(spec)),
  /**
   * A copy of a document without one field.
   *
   * @param spec - The field name and the document.
   * @returns The document without the field.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/unsetField/
   */
  unsetField: <const K extends string, I extends ObjectArg>(spec: {
    field: K;
    input: I;
  }): Expr<PropagateNull<Simplify<Omit<Exclude<ArgValue<I>, null | undefined>, K>>, I>> =>
    F.node("$unsetField", ExprNodes.spec(spec)),
  /**
   * Binds variables for one expression; each is a proxy in `in` (`v.discounted`, `v.customer.name`).
   *
   * @param spec - The variables and the callback that builds the expression from their proxies.
   * @returns The value of the expression built by `in`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/let/
   */
  let: <const Vars extends { readonly [name: string]: Arg<unknown> }, const R extends Arg<unknown>>(spec: {
    vars: Vars;
    in: (v: { readonly [K in keyof Vars]: VarProxy<UnwrapDeep<Vars[K]>> }) => R;
  }): Expr<UnwrapDeep<R>> => {
    const vars: Record<string, unknown> = {};
    const proxies: Record<string, unknown> = {};
    for (const name of Object.keys(spec.vars)) {
      vars[name] = ExprNodes.serialize(spec.vars[name]);
      proxies[name] = FieldProxies.variable(name);
    }
    /* The parameter is a mapped type over the caller's `Vars`; a loop cannot build it with its type. */
    return F.node("$let", {
      vars,
      in: ExprNodes.serialize(spec.in(proxies as { readonly [K in keyof Vars]: VarProxy<UnwrapDeep<Vars[K]>> })),
    });
  },
};
