import { SafeRecord } from "../../internal/safe-record.ts";
/*
 * One node of an aggregation expression. Every node carries the set of places it may be used — its
 * capabilities — as a phantom `K`, so `$group` refuses `f.price` (not an accumulator) and `fn.rank()` does not
 * compile outside a window (the server rejects both):
 *
 * | capability      | the node may be used …                                   | example                  |
 * |-----------------|----------------------------------------------------------|--------------------------|
 * | `"expr"`        | as an ordinary expression (argument of another operator, | `f.price`, `fn.add(…)`   |
 * |                 | `$addFields`, `$project`, `$match`/`$expr`, `$group._id`)|                          |
 * | `"acc"`         | as an accumulator (`$group`, `$bucket(Auto).output`)      | `fn.sum(f.price)`        |
 * | `"window"`      | as a `$setWindowFields` output                           | `fn.rank()`, `fn.sum(…)` |
 * | `"bounded"`     | with a `window: { documents | range }` (`withWindow`)     | `fn.sum(…)`, not `rank`  |
 * | `"needsSortBy"` | (a requirement, not a place) only with `sortBy`          | `fn.rank()`, `fn.shift`  |
 * | `"singleSortKey"` | (a requirement) only with a `sortBy` of exactly one field | `fn.rank()`, `linearFill` |
 *
 * An operator that is both an expression and an accumulator (`$sum` with one argument, `$avg`,
 * `$first`, `$max`, …) has both capabilities; `fn.push` has only `"acc" | "window" | "bounded"`, so
 * `fn.add(fn.push(…), 1)` does not compile (an accumulator cannot be nested inside an expression).
 */

/**
 * Where an expression node may be used (see the table above).
 *
 * @example
 * ```ts
 * const kinds: ExprKind[] = ["expr", "acc"]; // an operator usable both as an expression and as an accumulator
 * ```
 */
export type ExprKind = "expr" | "acc" | "window" | "bounded" | "needsSortBy" | "singleSortKey";

/**
 * Runtime key of the serialized MongoDB value inside a node. A symbol, so it never shows in
 * autocompletion next to real document fields.
 */
const NODE: unique symbol = Symbol("typemo.exprNode");

/** Type-level key of the phantom value type of a node. */
declare const VALUE: unique symbol;
/** Type-level key of the phantom capability record of a node. */
declare const KIND: unique symbol;

/**
 * The capability record of a node: one `true` key per capability. Extra keys are harmless.
 *
 * @typeParam K - The capabilities.
 * @example
 * ```ts
 * type C = ExprCapabilities<"expr" | "acc">; // { readonly expr: true; readonly acc: true }
 * ```
 */
export type ExprCapabilities<K extends ExprKind> = { readonly [P in K]: true };

/**
 * A built aggregation expression whose value has type `V` and which may be used where `K` says.
 *
 * - `[NODE]` holds the final serializable MongoDB value (`"$path"`, `{ $op: [...] }`, a literal);
 * - `V` sits in a one-element tuple so that `infer` keeps `undefined`/`null` members (from an optional plain
 *   member `infer` would drop `undefined`, and every operator would lose null propagation);
 * - `K` is a capability record, so a node with more capabilities is assignable where fewer are
 *   required, and a missing one fails with the capability's name in the message.
 *
 * @typeParam V - The value type of the expression.
 * @typeParam K - The places the node may be used.
 * @example
 * ```ts
 * const price: ExprNode<number> = f.price; // an ordinary expression
 * const total: ExprNode<number, "acc"> = fn.sum(f.price); // `fn.sum` is also an accumulator
 * ```
 */
export interface ExprNode<V, K extends ExprKind = "expr"> {
  /** The serialized MongoDB value. */
  readonly [NODE]: unknown;
  /** Phantom: the value type. */
  readonly [VALUE]?: readonly [V];
  /** Phantom: the capabilities. */
  readonly [KIND]?: ExprCapabilities<K>;
}

/**
 * The value type of a node (`V` of `ExprNode<V, K>`).
 *
 * @typeParam N - The node type.
 * @example
 * ```ts
 * type V = NodeValue<ExprNode<number>>; // number
 * ```
 */
export type NodeValue<N> = N extends ExprNode<infer V, never> ? V : never;

/**
 * The capabilities of a node.
 *
 * @typeParam N - The node type.
 * @example
 * ```ts
 * type K = NodeKind<ExprNode<number, "expr" | "acc">>; // "expr" | "acc"
 * ```
 */
export type NodeKind<N> = N extends { readonly [KIND]?: infer C } ? keyof NonNullable<C> & ExprKind : never;

/**
 * Any node, whatever its kind (the empty capability requirement). `ExprNode<unknown, ExprKind>` would be
 * the OPPOSITE: a node with every capability.
 *
 * @example
 * ```ts
 * const nodes: SomeExprNode[] = [f.price, fn.rank()];
 * ```
 */
export type SomeExprNode = ExprNode<unknown, never>;

/**
 * A node every signature accepts: the return type of an overloaded operator's implementation.
 * `never` is assignable to every value type and the full capability record to every requirement.
 *
 * @example
 * ```ts
 * declare const node: AnyExprNode;
 * const asNumber: ExprNode<number> = node; // assignable to every value type
 * const asAccumulator: ExprNode<string, "acc"> = node; // and to every capability
 * ```
 */
export type AnyExprNode = ExprNode<never, ExprKind>;

/**
 * Plain object check that does not walk into class instances (Date, ObjectId, Binary, Map, ...).
 *
 * @param value - The value to test.
 * @returns `true` for an object literal or a null-prototype object.
 */
const isPlainRecord = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Construction and serialization of expression nodes. The only code that touches `NODE`. */
export class ExprNodes {
  /**
   * A node around an already serializable MongoDB value.
   *
   * @typeParam V - The value type of the node.
   * @typeParam K - The capabilities of the node.
   * @param serializable - The final MongoDB value.
   * @returns The node.
   */
  static make<V, K extends ExprKind = "expr">(serializable: unknown): ExprNode<V, K> {
    return {
      [NODE]: serializable,
    };
  }

  /**
   * `true` for a node (a field reference, a variable or the result of an `fn.*` call).
   *
   * @param value - The value to test.
   * @returns Whether the value is an expression node.
   */
  static is(value: unknown): value is SomeExprNode {
    return (typeof value === "object" || typeof value === "function") && value !== null && NODE in value;
  }

  /**
   * The serialized value of a node.
   *
   * @param node - The node.
   * @returns The MongoDB value it holds.
   */
  static unwrap(node: SomeExprNode): unknown {
    return node[NODE];
  }

  /**
   * Serializes a value in an expression position: nodes are unwrapped, plain objects and arrays are
   * walked, everything else (Date, ObjectId, Decimal128, Binary, RegExp, numbers, ...) is a literal.
   *
   * A bare string that starts with `$` is wrapped in `$literal`: the server would read `"$5 off"` as a
   * field path and `"$$x"` as a variable (passed through, the value would silently become `null`/missing).
   * Field paths and variables are written with `f.field` / `Vars.*`, never as strings.
   * The input is never mutated: objects and arrays are copied.
   *
   * @param value - The value to serialize.
   * @returns The MongoDB value.
   */
  static serialize(value: unknown): unknown {
    if (ExprNodes.is(value)) return value[NODE];
    if (typeof value === "string") return value.startsWith("$") ? { $literal: value } : value;
    if (Array.isArray(value)) return value.map(ExprNodes.serialize);
    if (isPlainRecord(value)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) SafeRecord.set(out, key, ExprNodes.serialize(value[key]));
      return out;
    }
    return value;
  }

  /**
   * The single argument of a unary operator. An array literal must be wrapped in a one-element
   * array: MongoDB reads `{ $size: [1, 2, 3] }` as three arguments.
   *
   * @param value - The argument.
   * @returns The serialized argument, wrapped when it is an array.
   */
  static single(value: unknown): unknown {
    const serialized = ExprNodes.serialize(value);
    return Array.isArray(serialized) ? [serialized] : serialized;
  }

  /**
   * Serializes an operator's object-shaped spec (`{ input, n }`, `{ date, unit }`): keys whose value
   * is `undefined` are left out (the server rejects an explicit `null` for most options).
   *
   * @param spec - The spec object.
   * @returns A new record with serialized values.
   */
  static spec(spec: object): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(spec)) {
      if (value !== undefined) SafeRecord.set(out, key, ExprNodes.serialize(value));
    }
    return out;
  }
}
