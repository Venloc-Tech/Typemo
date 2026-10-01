import type { OpaqueValue } from "../../bson/opaque-value.ts";
import type { Paths } from "../../types/paths.ts";
import type { Simplify } from "../expressions/expr-types.ts";

/*
 * Path types of the pipeline.
 *
 * READ paths: `DocPaths` is `Paths<T>` (`src/types/paths.ts`). `ArrayPaths` (the operand of
 * `$unwind`: an array field, not through another array) and `PathAt` (the AGGREGATION value of a path:
 * through an array of subdocuments an array of values, unlike the filter-semantics `PathValue`) are
 * the pipeline's own.
 *
 * WRITE-TARGET operations on a document type (`SetPath`, `OmitPath`, `ApplyDottedKeys`, …) are the
 * pipeline's own: they model what `$addFields`/`$project`/`$unset`/`$lookup.as` do to a document.
 */

/** A value a path never walks into. */
type Leaf = string | number | boolean | bigint | null | undefined | OpaqueValue;

/** Depth counter: `Next[D]` is `D - 1`, which bounds the recursion of `ArrayPaths`. */
type Next = [never, 0, 1, 2, 3, 4];

/**
 * Keys of `T` that are strings, without an index signature (a record is addressed by its field key only).
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * type A = NamedKeys<{ a: 1; b: 2 }>; // "a" | "b"
 * type B = NamedKeys<Record<string, number>>; // never
 * ```
 */
type NamedKeys<T> = string extends keyof T ? never : keyof T & string;

/**
 * Dotted read paths of a document `T` (through subdocuments and arrays of them): `Paths<T>`.
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * type P = DocPaths<{ a: { b: number }; tags: string[] }>; // "a" | "a.b" | "tags"
 * ```
 */
export type DocPaths<T> = Paths<T>;

/**
 * The value at a read path in the AGGREGATION sense: a path through an array of subdocuments gives an
 * array of the values (`"$items.price"` → `number[]`), unlike the filter sense of `PathValue`.
 *
 * @typeParam T - The document type.
 * @typeParam P - The dotted path (without the leading `$`).
 * @example
 * ```ts
 * type A = PathAt<{ items: { price: number }[] }, "items.price">; // number[]
 * type B = PathAt<{ a: { b?: string } }, "a.b">; // string | undefined
 * ```
 */
export type PathAt<T, P extends string> = P extends `${infer H}.${infer R}`
  ? H extends keyof T
    ? NonNullable<T[H]> extends readonly (infer E)[]
      ? PathAt<NonNullable<E>, R>[] | Extract<T[H], null | undefined>
      :
          | PathAt<NonNullable<T[H]>, R>
          | (undefined extends T[H] ? undefined : never)
          | (null extends T[H] ? undefined : never)
    : never
  : P extends keyof T
    ? T[P] | (object extends Pick<T, P> ? undefined : never)
    : never;

/**
 * Read paths whose value is an array (what `$unwind` takes), not through another array.
 *
 * @typeParam T - The document type.
 * @typeParam D - The remaining recursion depth.
 * @example
 * ```ts
 * type A = ArrayPaths<{ tags: string[]; meta: { list: number[] }; n: number }>; // "tags" | "meta.list"
 * ```
 */
export type ArrayPaths<T, D extends number = 5> = [D] extends [never]
  ? never
  : {
      [K in NamedKeys<T>]-?: NonNullable<T[K]> extends readonly unknown[]
        ? K
        : NonNullable<T[K]> extends Leaf
          ? never
          : string extends keyof NonNullable<T[K]>
            ? never
            : `${K}.${ArrayPaths<NonNullable<T[K]>, Next[D]>}`;
    }[NamedKeys<T>];

/**
 * `true` for an embedded document (not an opaque value, array or primitive).
 *
 * @typeParam T - The type to test.
 * @example
 * ```ts
 * type A = IsDocument<{ a: 1 }>; // true
 * type B = IsDocument<string[]>; // false
 * ```
 */
export type IsDocument<T> = [T] extends [Leaf | readonly unknown[]] ? false : [T] extends [object] ? true : false;

/**
 * `"a.b.c"` → `{ a: { b: { c: V } } }`.
 *
 * @typeParam P - The dotted path.
 * @typeParam V - The value at the leaf.
 * @example
 * ```ts
 * type A = NestedFromPath<"a.b", number>; // { a: { b: number } }
 * ```
 */
export type NestedFromPath<P extends string, V> = P extends `${infer H}.${infer R}`
  ? { [K in H]: NestedFromPath<R, V> }
  : { [K in P]: V };

/**
 * The keys of `F` that contain a dot.
 *
 * @typeParam F - The object type.
 * @example
 * ```ts
 * type A = DottedKeys<{ "a.b": 1; c: 2 }>; // "a.b"
 * ```
 */
export type DottedKeys<F> = Extract<keyof F, `${string}.${string}`>;

/**
 * The keys of `F` without a dot.
 *
 * @typeParam F - The object type.
 * @example
 * ```ts
 * type A = PlainKeys<{ "a.b": 1; c: 2 }>; // "c"
 * ```
 */
export type PlainKeys<F> = Exclude<keyof F, DottedKeys<F>>;

/**
 * The last member of a union (to fold over a union of keys).
 *
 * @typeParam U - The union.
 * @example
 * ```ts
 * type A = LastOf<"a" | "b">; // "b" (which member is last is decided by the compiler)
 * ```
 */
export type LastOf<U> = (U extends unknown ? (x: () => U) => void : never) extends (x: infer I) => void
  ? I extends () => infer R
    ? R
    : never
  : never;

/**
 * Replaces (or creates) the value at a dotted path, keeping siblings. The leaf is REPLACED, never
 * intersected (`string & number` is `never` and the field would vanish).
 *
 * @typeParam T - The document type.
 * @typeParam P - The dotted path to write.
 * @typeParam V - The new value type at the path.
 * @example
 * ```ts
 * type A = SetPath<{ a: { b: string; c: 1 } }, "a.b", number>; // { a: { b: number; c: 1 } }
 * ```
 */
export type SetPath<T, P extends string, V> = Simplify<
  P extends `${infer H}.${infer R}`
    ? Omit<T, H> & {
        [K in H]: H extends keyof T
          ?
              | (IsDocument<NonNullable<T[H]>> extends true ? SetPath<NonNullable<T[H]>, R, V> : NestedFromPath<R, V>)
              | (undefined extends T[H] ? NestedFromPath<R, V> : never)
              | (null extends T[H] ? NestedFromPath<R, V> : never)
          : NestedFromPath<R, V>;
      }
    : Omit<T, P> & { [K in P]: V }
>;

/**
 * Removes the value at a dotted path, keeping siblings (through arrays of subdocuments too).
 *
 * @typeParam T - The document type.
 * @typeParam P - The dotted path to remove.
 * @example
 * ```ts
 * type A = OmitPath<{ a: { b: 1; c: 2 } }, "a.b">; // { a: { c: 2 } }
 * ```
 */
export type OmitPath<T, P extends string> = P extends `${infer H}.${infer R}`
  ? H extends keyof T
    ? Simplify<{ [K in keyof T]: K extends H ? OmitInside<T[K], R> : T[K] }>
    : T
  : Simplify<Omit<T, P>>;

/**
 * Removes the path `R` inside a value: element by element for an array, inside an embedded document otherwise.
 *
 * @typeParam V - The value that contains the path.
 * @typeParam R - The remaining dotted path.
 * @example
 * ```ts
 * type A = OmitInside<{ b: 1; c: 2 }[], "b">; // { c: 2 }[]
 * ```
 */
type OmitInside<V, R extends string> = V extends readonly (infer E)[]
  ? OmitInside<E, R>[]
  : IsDocument<NonNullable<V>> extends true
    ? OmitPath<NonNullable<V>, R> | Extract<V, null | undefined>
    : V;

/**
 * Readable type-level error (`{ error: "…" }` stays readable where a bare string would collapse to `never`).
 *
 * @typeParam M - The message.
 * @example
 * ```ts
 * type E = PathError<"a is an array">; // { readonly error: "a is an array" }
 * ```
 */
export interface PathError<M extends string> {
  /** The message. */
  readonly error: M;
}

/**
 * Why a dotted write target `P` cannot be written on `T` (a `PathError`), or `never` when it can.
 *
 * @typeParam T - The document type.
 * @typeParam P - The dotted write target.
 * @example
 * ```ts
 * type A = PathProblem<{ tags: string[] }, "tags.x">; // PathError<'"tags" is an array: …'>
 * type B = PathProblem<{ a: { b: 1 } }, "a.c">; // never
 * ```
 */
export type PathProblem<T, P extends string> = P extends `${infer H}.${infer R}`
  ? H extends keyof T
    ? SegmentProblem<NonNullable<T[H]>, H, R>
    : never
  : never;

/**
 * The problem of writing the rest `R` of a path inside the value `N` found at the segment `H`.
 *
 * @typeParam N - The (non-null) value at the segment.
 * @typeParam H - The segment name, used in the message.
 * @typeParam R - The rest of the path.
 * @example
 * ```ts
 * type A = SegmentProblem<number, "n", "x">; // PathError<'"n" is not an embedded document, …'>
 * ```
 */
type SegmentProblem<N, H extends string, R extends string> = N extends readonly unknown[]
  ? PathError<`"${H}" is an array: a dotted key would write into every element. Use fn.map to change elements.`>
  : IsDocument<N> extends true
    ? PathProblem<N, R>
    : PathError<`"${H}" is not an embedded document, so nothing can be written inside it.`>;

/**
 * The dotted keys of `F` that cannot be written on `T`, mapped to their message.
 *
 * @typeParam T - The document type.
 * @typeParam F - The object with the dotted keys to write.
 * @example
 * ```ts
 * type A = InvalidPathKeys<{ tags: string[] }, { "tags.x": 1 }>; // { "tags.x": PathError<'…'> }
 * ```
 */
export type InvalidPathKeys<T, F> = {
  [K in DottedKeys<F> as PathProblem<T, K & string> extends never ? never : K]: PathProblem<T, K & string>;
};

/**
 * Applies every dotted key of `F` to `T` (order does not matter for distinct paths).
 *
 * @typeParam T - The document type.
 * @typeParam F - The object whose dotted keys are written.
 * @typeParam Keys - The dotted keys still to apply (internal accumulator).
 * @example
 * ```ts
 * type A = ApplyDottedKeys<{ a: { b: 1 } }, { "a.b": string }>; // { a: { b: string } }
 * ```
 */
export type ApplyDottedKeys<T, F, Keys = DottedKeys<F>> = [Keys] extends [never]
  ? T
  : LastOf<Keys> extends infer L extends string
    ? L extends keyof F
      ? ApplyDottedKeys<SetPath<T, L, F[L]>, F, Exclude<Keys, L>>
      : T
    : T;
