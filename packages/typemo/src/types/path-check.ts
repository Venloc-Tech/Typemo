import type { Condition, Filter, FilterPaths, FilterValue, RootOperators } from "./filter.ts";

/*
 * Paths the enumerated types cannot express are CHECKED on the keys actually passed, with the
 * filter/update as a generic (`const F extends Filter<T, true>`), the same technique as the populate check:
 *
 * - fields inside the values of a Map (`badges.gold.title`): a template key `badges.${string}` also
 *   matches `badges.gold.title`, so an enumerated type either refuses the inner field or accepts any
 *   value. The generic constraint leaves map-entry keys `unknown`; this check walks each actual key
 *   (`FilterValue`/`WriteValue` go through Map keys) and checks its value;
 * - unknown keys: a generic argument has no excess-property check, so they are reported here;
 * - `undefined` values: refused on every key and on the operators one level down, whatever the user's
 *   `exactOptionalPropertyTypes` is (without it an optional property silently accepts `undefined`).
 *
 * Fields of union members inside arrays (`blocks.url`) need no check: the enumerated paths are built
 * member by member (`paths.ts`, `filter.ts`).
 */

/**
 * `true` for a filter or update that is not a literal: a `const` type parameter infers an object literal
 * with required readonly keys only, a declared type (`Filter<T>`, `Update<T>`) has optional keys. Such an
 * argument was checked by the constraint; walking its every optional key would report them all.
 *
 * @typeParam F - The filter or update type.
 * @example
 * type A = IsWide<{ readonly age: 1 }>; // false (a literal)
 * type B = IsWide<{ age?: number }>; // true (a declared type with optional keys)
 */
export type IsWide<F> = [{ [K in keyof F]-?: Record<never, never> extends Pick<F, K> ? K : never }[keyof F]] extends [
  never,
]
  ? false
  : true;

/**
 * `true` for a template key that ends in a Map entry (`badges.${string}`, `profile.prefs.${string}`).
 *
 * @typeParam P - The path.
 * @example
 * type A = IsMapEntryKey<`badges.${string}`>; // true
 * type B = IsMapEntryKey<"name">; // false
 */
export type IsMapEntryKey<P> = P extends `${string}.${infer L}` ? (string extends L ? true : IsMapEntryKey<L>) : false;

/**
 * `true` for a literal key with an array index segment (`tags.0`, `links.1.clicks`). The constraint of the builders
 * takes any value for the index-pattern keys it enumerates (so that a dynamic `Record<string, unknown>` filter is
 * assignable), and `FilterProblems` checks the value of such a key like a Map entry.
 *
 * @typeParam K - The filter key.
 * @example
 * type A = IsIndexedKey<"tags.0">; // true
 * type B = IsIndexedKey<"name">; // false
 */
type IsIndexedKey<K extends string> = K extends `${infer Head}.${infer Rest}`
  ? Head extends `${number}`
    ? true
    : IsIndexedKey<Rest>
  : K extends `${number}`
    ? true
    : false;

/**
 * Map-entry keys of the filter paths (`counters.${string}`, `badges.${string}`).
 *
 * @typeParam T - The entity type.
 * @example
 * type A = FilterMapEntries<{ counters: Map<string, number>; name: string }>; // `counters.${string}`
 */
export type FilterMapEntries<T> = {
  [P in FilterPaths<T>]-?: IsMapEntryKey<P> extends true ? P : never;
}[FilterPaths<T>];

/**
 * The messages for the operators of value `V` that are `undefined`, one level below key `K`.
 *
 * @typeParam V - The condition object of the key.
 * @typeParam K - The filter key.
 * @example
 * type A = UndefinedOperators<{ $gt: number | undefined }, "age">; // `"age.$gt" is undefined (...)`
 */
type UndefinedOperators<V, K extends string> = V extends readonly unknown[]
  ? never
  : V extends object
    ? {
        [O in keyof V & string]-?: undefined extends V[O]
          ? `"${K}.${O}" is undefined (undefined is never a value)`
          : never;
      }[keyof V & string]
    : never;

/**
 * The problems of the clauses of `$and`/`$or`/`$nor`: each clause is checked as a filter.
 *
 * @typeParam T - The entity type.
 * @typeParam F - The clause list type.
 * @example
 * type A = ClauseProblems<User, [{ age: 1 }]>; // never
 * type B = ClauseProblems<User, 1>; // "a clause of $and/$or/$nor must be a filter"
 */
type ClauseProblems<T, F> = F extends readonly unknown[]
  ? IsWide<F[number]> extends true
    ? never
    : FilterProblems<T, F[number]>
  : "a clause of $and/$or/$nor must be a filter";

/**
 * The problems of filter `F` of `T` (a union of messages, `never` when there are none).
 *
 * @typeParam T - The entity type.
 * @typeParam F - The filter literal type.
 * @example
 * type A = FilterProblems<User, { nme: 1 }>; // `unknown field "nme"`
 * type B = FilterProblems<User, { name: "a" }>; // never
 */
export type FilterProblems<T, F> = {
  [K in keyof F & string]-?: K extends "$and" | "$or" | "$nor"
    ? ClauseProblems<T, F[K]>
    : undefined extends F[K]
      ? `"${K}" is undefined (undefined is never a value; use $exists: false)`
      : K extends `$${string}`
        ? K extends keyof RootOperators<T>
          ? never
          : `unknown operator "${K}"`
        : K extends keyof Filter<T, true>
          ? (K extends FilterMapEntries<T> ? true : IsIndexedKey<K>) extends true
            ? [FilterValue<T, K>] extends [never]
              ? `unknown field "${K}"`
              : F[K] extends Condition<FilterValue<T, K>>
                ? UndefinedOperators<F[K], K>
                : `"${K}": the condition does not fit the field's type`
            : UndefinedOperators<F[K], K>
          : /* not enumerated (deeper than the path ceiling): walked like a Map entry */
            [FilterValue<T, K>] extends [never]
            ? `unknown field "${K}"`
            : F[K] extends Condition<FilterValue<T, K>>
              ? UndefinedOperators<F[K], K>
              : `"${K}": the condition does not fit the field's type`;
}[keyof F & string];

/**
 * `unknown` when filter `F` is valid, otherwise a required property that carries the messages. Intersected
 * with the filter parameter, it lets a valid filter through and makes an invalid one fail with the messages.
 *
 * @typeParam T - The entity type.
 * @typeParam F - The filter literal type.
 * @example
 * type A = FilterCheck<User, { name: "a" }>; // unknown
 * type B = FilterCheck<User, { nme: "a" }>; // { readonly "filter error": `unknown field "nme"` }
 */
export type FilterCheck<T, F> =
  IsWide<F> extends true
    ? /* a declared filter type (a variable typed `Filter<T>`), not a literal: the constraint checked it */
      unknown
    : [Filter<T, true>] extends [F]
      ? /* F was not inferred: no argument (`find()`), or the argument fails the constraint, which reports it */
        unknown
      : /*
         * No default for F: a default fixes F before a context-sensitive `$expr: (f) => …` is typed, and `f`
         * would become an implicit `any`.
         */
        [FilterProblems<T, F>] extends [never]
        ? unknown
        : { readonly "filter error": FilterProblems<T, F> };

/**
 * What an empty filter would do, by the form of the write: a One form (`updateOne`, `replaceOne`, `deleteOne`,
 * `findOneAnd*`) changes or removes one arbitrary document, a Many form (`updateMany`, `deleteMany`) every one.
 * The same words as the run-time error.
 *
 * @example
 * type A = EmptyFilterEffect<"many">; // "affect every document"
 */
type EmptyFilterEffect<Form extends WriteForm> = Form extends "one"
  ? "change or remove an arbitrary document"
  : "affect every document";

/**
 * The form of a write for {@link WriteFilterCheck}: `"one"` for the One forms (one document at most), `"many"` for
 * the Many forms.
 *
 * @example
 * const form: WriteForm = "many";
 */
export type WriteForm = "one" | "many";

/**
 * `FilterCheck` for the writes that change or remove documents (`updateOne`, `updateMany`, `replaceOne`,
 * `deleteOne`, `deleteMany`, `findOneAndUpdate`, `findOneAndReplace`, `findOneAndDelete`): an empty object literal
 * is refused at compile time, like at run time (`StrictModeError` with rule `empty-filter`), and the text says
 * what it would do by the form of the method (`Form`): a One form would change or remove an arbitrary document, a
 * Many form would affect every document. `Filters.all()` is the explicit "every document". A filter typed as a
 * variable (`Filter<T>`) is not a literal: it has keys, and the run-time rule still applies to it.
 *
 * @typeParam T - The entity type.
 * @typeParam F - The filter literal type.
 * @typeParam Form - The form of the write method.
 * @example
 * type A = WriteFilterCheck<User, { name: "a" }, "one">; // unknown
 * type B = WriteFilterCheck<User, {}, "many">; // { readonly "filter error": "an empty filter would affect every document; …" }
 */
export type WriteFilterCheck<T, F, Form extends WriteForm> = FilterCheck<T, F> &
  /*
   * `"$and" extends keyof F` tells a declared filter type (`Filter<T>`, also in a generic helper: its keys
   * include the root operators whatever `T` is, so this resolves without knowing `T`) from a literal. A
   * conditional on the literal's keys alone stays unresolved for `Filter<T>` with a generic `T`, and that
   * filter would not be assignable to it.
   */
  ("$and" extends keyof F
    ? unknown
    : [keyof F] extends [never]
      ? {
          readonly "filter error": `an empty filter would ${EmptyFilterEffect<Form>}; pass a filter, or Filters.all() to mean every document on purpose`;
        }
      : unknown);
