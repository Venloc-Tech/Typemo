import type { Unbranded } from "./markers.ts";
import type { Simplify } from "./type-utils.ts";

/*
 * Narrowing the result by the conditions of `where(path)…`: after `.where("role").in(["admin", "editor"])`
 * every result has `role: "admin" | "editor"`, after `.where("nick").exists()` an optional `nick` is
 * present. Only a TOP-LEVEL field of a FINITE type narrows (a literal union, `boolean`, enum members):
 * `string`/`number` would only be narrowed to the literals compared with (noise, no information), an
 * array is matched by its elements.
 *
 * `exists()` removes only `undefined`: `{ $exists: true }` matches `field: null` too, so a nullable
 * field stays nullable.
 *
 * The state is two type parameters of the query: `N` (field → the values it can still have) and
 * `X` (fields known to exist). They are applied to the final document type (after projection and
 * populate), so a later `select()` never loses them.
 */

/**
 * No narrowing yet.
 *
 * @example
 * type N = NoNarrowing; // {}
 */
export type NoNarrowing = Record<never, never>;

/**
 * A field type with finitely many values (literal union, `boolean`, enum members).
 *
 * @typeParam F - The field type.
 * @example
 * type A = IsFinite<"a" | "b">; // true
 * type B = IsFinite<string>; // false
 * type C = IsFinite<"a"[]>; // false
 */
export type IsFinite<F> = [F] extends [never]
  ? false
  : [F] extends [readonly unknown[]]
    ? false
    : string extends F
      ? false
      : number extends F
        ? false
        : bigint extends F
          ? false
          : [F] extends [string | number | boolean]
            ? true
            : false;

/**
 * The values field `K` of `T` can still have under narrowing `N` (markers removed; `null`/`undefined` kept).
 *
 * @typeParam N - The narrowing state.
 * @typeParam T - The entity type.
 * @typeParam K - The field name.
 * @example
 * type A = NarrowBase<{}, { role: "admin" | "user" }, "role">; // "admin" | "user"
 * type B = NarrowBase<{ role: "admin" }, { role: "admin" | "user" }, "role">; // "admin"
 */
export type NarrowBase<N, T, K extends string> = K extends keyof N ? N[K] : K extends keyof T ? Unbranded<T[K]> : never;

/**
 * Whether field `K` can be narrowed: a top-level field of a finite type.
 *
 * @typeParam N - The narrowing state.
 * @typeParam T - The entity type.
 * @typeParam K - The field path.
 * @example
 * type A = CanNarrow<{}, { role: "a" | "b"; name: string }, "role">; // true
 * type B = CanNarrow<{}, { name: string }, "name">; // false
 */
type CanNarrow<N, T, K extends string> = K extends `${string}.${string}`
  ? false
  : IsFinite<NonNullable<NarrowBase<N, T, K>>>;

/**
 * The field equals one of `X`.
 *
 * @typeParam N - The narrowing state.
 * @typeParam T - The entity type.
 * @typeParam K - The field name.
 * @typeParam X - The compared values.
 * @example
 * type A = NarrowIn<{}, { role: "a" | "b" | "c" }, "role", "a" | "b">; // { readonly role: "a" | "b" }
 */
export type NarrowIn<N, T, K extends string, X> =
  CanNarrow<N, T, K> extends true
    ? [Extract<NarrowBase<N, T, K>, X>] extends [never]
      ? N
      : Simplify<Omit<N, K> & { readonly [P in K]: Extract<NarrowBase<N, T, K>, X> }>
    : N;

/**
 * The field differs from all of `X` (a missing field also differs, so `undefined` stays).
 *
 * @typeParam N - The narrowing state.
 * @typeParam T - The entity type.
 * @typeParam K - The field name.
 * @typeParam X - The excluded values.
 * @example
 * type A = NarrowNotIn<{}, { role: "a" | "b" | "c" }, "role", "a">; // { readonly role: "b" | "c" }
 */
export type NarrowNotIn<N, T, K extends string, X> =
  CanNarrow<N, T, K> extends true
    ? [Exclude<NarrowBase<N, T, K>, X>] extends [never]
      ? N
      : Simplify<Omit<N, K> & { readonly [P in K]: Exclude<NarrowBase<N, T, K>, X> }>
    : N;

/**
 * The field exists: added to the set `X` of existing top-level fields (a dotted path is ignored).
 *
 * @typeParam X - The fields known to exist.
 * @typeParam K - The field path.
 * @example
 * type A = NarrowExists<never, "nick">; // "nick"
 * type B = NarrowExists<"nick", "a.b">; // "nick"
 */
export type NarrowExists<X extends string, K extends string> = K extends `${string}.${string}` ? X : X | K;

/**
 * The keys of `N` whose narrowed value can no longer be `undefined`.
 *
 * @typeParam N - The narrowing state.
 * @example
 * type A = RequiredKeys<{ a: "x"; b: "y" | undefined }>; // "a"
 */
type RequiredKeys<N> = { [K in keyof N]-?: undefined extends N[K] ? never : K }[keyof N];

/**
 * Applies the narrowing state to a document type `D`; a key of `N` that `D` lacks is an added field (`textScore()`).
 *
 * @typeParam D - The document type after projection and populate.
 * @typeParam N - The narrowing state.
 * @typeParam X - The fields known to exist.
 * @example
 * type A = ApplyNarrow<{ role: "a" | "b"; nick?: string }, { role: "a" }, "nick">;
 * // { role: "a"; nick: string }
 */
export type ApplyNarrow<D, N, X extends string> = [keyof N | X] extends [never]
  ? D
  : Simplify<
      Omit<D, (keyof N | X) & keyof D> & {
        [K in (RequiredKeys<N> | (X & keyof N)) & keyof D]: Exclude<N[K], undefined>;
      } & {
        [K in Exclude<keyof N, RequiredKeys<N> | X> & keyof D]?: Exclude<N[K], undefined>;
      } & {
        [K in Exclude<X & keyof D, keyof N>]-?: Exclude<D[K], undefined>;
      } & {
        readonly [K in Exclude<keyof N, keyof D>]: N[K];
      }
    >;
