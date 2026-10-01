import type { Binary } from "mongodb";
import { type AnyExprNode, ExprNodes } from "../expr-node.ts";
import type { Arg, Nullable, PropagateNull } from "../expr-types.ts";
import { type Expr, OperatorFactory as F } from "../operator-factory.ts";

/* Bitwise, random, metadata and vector similarity operators. */

/**
 * An integer for the bitwise operators: int32 (`number`) or int64 (`bigint`).
 *
 * @example
 * ```ts
 * const a: IntArg = 5;
 * const b: IntArg = 5n;
 * const c: IntArg = f.flags;
 * ```
 */
type IntArg = Arg<Nullable<number | bigint>>;

/**
 * The value type of a bitwise argument: `V` of an expression, the type itself for a bare value.
 *
 * @typeParam A - The argument type.
 * @example
 * ```ts
 * type A = IntValue<Expr<bigint>>; // bigint
 * type B = IntValue<number>; // number
 * ```
 */
type IntValue<A> = A extends Expr<infer V> ? V : A;

/**
 * int64 when any argument is a `bigint`, else int32.
 *
 * @typeParam A - The union of the argument types.
 * @example
 * ```ts
 * type A = BitResult<number | bigint>; // bigint
 * type B = BitResult<number>; // number
 * ```
 */
type BitResult<A> = [Extract<IntValue<A>, bigint>] extends [never] ? number : bigint;

/**
 * Builds a variadic (2+) bitwise operator that passes `null` through.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator; its result is `bigint` when any argument is a `bigint`.
 */
const bitwise =
  (op: string) =>
  <A extends IntArg, B extends IntArg, R extends readonly IntArg[]>(
    a: A,
    b: B,
    ...rest: R
  ): Expr<PropagateNull<BitResult<A | B | R[number]>, A | B | R[number]>> =>
    F.node(op, [a, b, ...rest].map(ExprNodes.serialize));

/**
 * A vector for `$similarity*`: numbers, or a `binData` vector (subtype 9).
 *
 * @example
 * ```ts
 * const a: SimilarityVector = [0.1, 0.2, 0.3];
 * const b: SimilarityVector = Binary.fromFloat32Array(new Float32Array([0.1, 0.2, 0.3]));
 * ```
 */
export type SimilarityVector = readonly number[] | Binary;

/**
 * An argument that is a vector: an expression or a bare vector, possibly `null`/missing.
 *
 * @example
 * ```ts
 * const a: VectorArg = [1, 2, 3];
 * const b: VectorArg = f.embedding;
 * ```
 */
type VectorArg = Arg<Nullable<SimilarityVector>>;

/**
 * `$similarity*`: two vectors, or `{ vectors: [a, b], score }` (`score` normalizes to `[0, 1]`).
 *
 * @example
 * ```ts
 * fn.similarityCosine(f.embedding, [0.1, 0.2]); // Expr<number | null> when `embedding` may be missing
 * fn.similarityCosine({ vectors: [f.a, f.b], score: true });
 * ```
 */
export interface SimilarityOp {
  /**
   * Similarity of two vectors.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @returns The similarity, `null` when an argument can be `null` or missing.
   */
  <A extends VectorArg, B extends VectorArg>(a: A, b: B): Expr<PropagateNull<number, A | B>>;
  /**
   * Similarity of two vectors given as a spec.
   *
   * @param spec - The two vectors and whether the result is normalized to `[0, 1]`.
   * @returns The similarity, `null` when an argument can be `null` or missing.
   */
  <A extends VectorArg, B extends VectorArg>(spec: {
    vectors: readonly [A, B];
    score?: boolean;
  }): Expr<PropagateNull<number, A | B>>;
}

/**
 * Builds a `$similarity*` operator.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator accepting two vectors or a spec.
 */
const similarity = (op: string): SimilarityOp =>
  ((a: unknown, b?: unknown): AnyExprNode => {
    if (b !== undefined) return F.node(op, [ExprNodes.serialize(a), ExprNodes.serialize(b)]);
    const spec = a as { vectors: readonly unknown[]; score?: boolean };
    return F.node(op, {
      vectors: spec.vectors.map(ExprNodes.serialize),
      ...(spec.score === undefined ? {} : { score: spec.score }),
    });
  }) as SimilarityOp;

/**
 * `$meta` keywords and their value types.
 *
 * @example
 * ```ts
 * type Score = MetaValues["textScore"]; // number
 * type Key = MetaValues["sortKey"]; // { [key: string]: unknown }
 * ```
 */
export interface MetaValues {
  /** The `$text` relevance score. */
  textScore: number;
  /** The index key metadata. */
  indexKey: { [key: string]: unknown };
  /** The Atlas Search score. */
  searchScore: number;
  /** The Atlas Search highlights. */
  searchHighlights: unknown[];
  /** The Atlas Search score details. */
  searchScoreDetails: { [key: string]: unknown };
  /** The Atlas Search sequence token. */
  searchSequenceToken: string;
  /** The Atlas Vector Search score. */
  vectorSearchScore: number;
  /** The distance computed by `$geoNear`. */
  geoNearDistance: number;
  /** The point computed by `$geoNear`. */
  geoNearPoint: unknown;
  /** The random value metadata. */
  randVal: number;
  /** The record id metadata. */
  recordId: bigint;
  /** The sort key metadata. */
  sortKey: { [key: string]: unknown };
  /** The score metadata. */
  score: number;
  /** The score details metadata. */
  scoreDetails: { [key: string]: unknown };
}

/** Bitwise, random, metadata and vector similarity operators. */
export const miscOps = {
  /**
   * Bitwise AND (MongoDB 6.3+).
   *
   * @param a - The first integer.
   * @param b - The second integer.
   * @param rest - More integers.
   * @returns The AND of all arguments; `bigint` when any is a `bigint`, `null` when any can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/bitAnd/
   */
  bitAnd: bitwise("$bitAnd"),
  /**
   * Bitwise OR.
   *
   * @param a - The first integer.
   * @param b - The second integer.
   * @param rest - More integers.
   * @returns The OR of all arguments; `bigint` when any is a `bigint`, `null` when any can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/bitOr/
   */
  bitOr: bitwise("$bitOr"),
  /**
   * Bitwise XOR.
   *
   * @param a - The first integer.
   * @param b - The second integer.
   * @param rest - More integers.
   * @returns The XOR of all arguments; `bigint` when any is a `bigint`, `null` when any can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/bitXor/
   */
  bitXor: bitwise("$bitXor"),
  /**
   * Bitwise NOT.
   *
   * @param x - The integer.
   * @returns The bitwise complement; `bigint` for a `bigint`, `null` when the argument can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/bitNot/
   */
  bitNot: <A extends IntArg>(x: A): Expr<PropagateNull<BitResult<A>, A>> => F.node("$bitNot", ExprNodes.serialize(x)),
  /**
   * A random double in `[0, 1)`.
   *
   * @returns The random number expression.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/rand/
   */
  rand: F.nullary<number>("$rand"),
  /**
   * Per-document metadata (`"textScore"`, `"searchScore"`, …).
   *
   * @param name - The metadata keyword.
   * @returns The metadata value, typed by the keyword.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/meta/
   */
  meta: <const N extends keyof MetaValues>(name: N): Expr<MetaValues[N]> => F.node("$meta", name),
  /**
   * Cosine similarity (MongoDB 8.3+).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/similarityCosine/
   */
  similarityCosine: similarity("$similarityCosine"),
  /**
   * Dot product (MongoDB 8.3+).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/similarityDotProduct/
   */
  similarityDotProduct: similarity("$similarityDotProduct"),
  /**
   * Euclidean distance (MongoDB 8.3+).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/similarityEuclidean/
   */
  similarityEuclidean: similarity("$similarityEuclidean"),
};
