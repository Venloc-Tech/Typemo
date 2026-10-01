import type { IsVector } from "../../bson/bson-type-table.ts";
import type {
  IsDefaulted,
  IsHidden,
  IsImmutable,
  IsVirtualRef,
  IsVirtualValue,
  RefMarker,
  RefModel,
  Unbranded,
} from "../../types/markers.ts";
import type { ReadonlyArrays } from "../options/prop-options.ts";
import type { ElementSpec, EntityClass, SpecValue, UnsupportedSpec } from "../options/type-spec.ts";

/*
 * The type rules of `@Prop`, shared by the legacy decorators of the core and the TC39 package: the
 * packages differ only in how they obtain the field type (`T[K]` from the prototype vs `Value` from
 * the decorator context). `PropCheck` is `true` when the options agree with the declared field type,
 * otherwise the first broken rule as a message.
 *
 * Rules, in order:
 *  1. the spec is a supported type (`Set`, `Map`, `Array`, `Object` … are not);
 *  2. the field is not a virtual (`VirtualRef` → `@Virtual`; `Computed`/`VirtualValue` → getters);
 *  3. ref: a `Ref<M>` field (an array of them, a Map of them) ⇔ `ref: () => M`, `refPath` or `refModel`
 *     (exactly one; `refModel` returns M's class), same model;
 *  4. type: `() => X` produces exactly the field type; classes match exactly, a subclass is not its
 *     base, except a union of classes of the hierarchy for embedded discriminators; a vector field
 *     is `Vector`;
 *  5. enum: a literal-union field ⇔ `enum` with exactly its members, for arrays per element;
 *  6. default ⇔ `Defaulted<T>` (an array field may take `default` without it), and the default fits the field;
 *  7. immutable ⇔ `Immutable<T>`;
 *  8. hidden ⇔ `Hidden<T>`;
 *  9. nullable ⇔ `| null` in the field type (`null` is accepted only on nullable paths).
 * `required` is explicit and not compared with `?`/`!`. Messages name only the field and the
 * rule: a type cannot be printed into a message (the compiler prints it on the next line itself).
 */

/**
 * Mutual assignability of two types.
 *
 * @example
 * ```ts
 * type R = Same<string, string>; // true
 * ```
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Removes the reference marker from a type.
 *
 * @example
 * ```ts
 * type Id = StripRef<Ref<User, number>>; // number
 * ```
 */
type StripRef<V> = V extends infer P & RefMarker<infer _M> ? P : V;

/**
 * The field type as the checks compare it: without `null`/`undefined` and markers, `Date` normalized,
 * a `Ref<M, Id>` replaced by its id type, arrays element-wise. Primitive markers stay on literal
 * members only through `Unbranded` (intersection inference keeps enum members intact).
 *
 * @example
 * ```ts
 * type V = CheckedValue<string | null>; // string
 * ```
 */
export type CheckedValue<F> = PlainMember<Unbranded<NonNullable<F>>>;

/**
 * One union member of {@link CheckedValue}.
 *
 * @example
 * ```ts
 * type V = PlainMember<Date>; // Date
 * ```
 */
type PlainMember<V> = V extends unknown
  ? V extends Date
    ? Date
    : V extends RefMarker<unknown>
      ? StripRef<V>
      : V extends readonly (infer E)[]
        ? CheckedValue<E>[]
        : V
  : never;

/**
 * `true` when `U` is a union of several types.
 *
 * @example
 * ```ts
 * type R = IsUnion<string | number>; // true
 * ```
 */
type IsUnion<U> = [U] extends [UnionToIntersection<U>] ? false : true;

/**
 * The intersection of the members of a union.
 *
 * @example
 * ```ts
 * type I = UnionToIntersection<{ a: 1 } | { b: 2 }>; // { a: 1 } & { b: 2 }
 * ```
 */
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/**
 * Embedded discriminators: the field may be declared as a UNION of classes of the spec class's
 * hierarchy, `@Prop(() => [Shape]) shapes!: (Circle | Square)[]`, so the type sees every member's
 * fields. Only for class specs, level by level through arrays and Maps. At run time a value is
 * resolved by its discriminator key or by its class, and a class that is not a registered
 * discriminator of the spec class is refused (`SchemaWalker`). No marker is needed.
 *
 * @example
 * ```ts
 * type R = IsSubclassUnion<(Circle | Square)[], Shape[]>; // true
 * ```
 */
export type IsSubclassUnion<FV, SV> = [FV] extends [readonly (infer FE)[]]
  ? [SV] extends [readonly (infer SE)[]]
    ? IsSubclassUnion<FE, SE>
    : false
  : [FV] extends [ReadonlyMap<string, infer FM>]
    ? [SV] extends [ReadonlyMap<string, infer SM>]
      ? IsSubclassUnion<FM, SM>
      : false
    : [SV] extends [object]
      ? IsUnion<FV> extends true
        ? [FV] extends [SV]
          ? true
          : false
        : false
      : false;

/**
 * Literal members widened to their primitive: `"a" | "b"` → `string`, `Color.Red` → `number`.
 *
 * @example
 * ```ts
 * type W = Widen<"a" | "b">; // string
 * ```
 */
export type Widen<V> = V extends string
  ? string
  : V extends number
    ? number
    : V extends boolean
      ? boolean
      : V extends bigint
        ? bigint
        : V extends readonly (infer E)[]
          ? Widen<E>[]
          : V;

/**
 * The element of an array type (one level per array spec level), the type itself otherwise.
 *
 * @example
 * ```ts
 * type E = ElementValue<string[], [StringConstructor]>; // string
 * ```
 */
type ElementValue<V, S> = S extends readonly [infer E] ? (V extends readonly (infer I)[] ? ElementValue<I, E> : V) : V;

/**
 * A finite union of string or number literals (TS `enum` members included). `number extends Level` is
 * true for a numeric enum (TS numeric enums accept any number), so wide `number` is recognized by its
 * template form instead: only `number` itself prints as `${number}`.
 *
 * @example
 * ```ts
 * type R = IsLiteralUnion<"a" | "b">; // true
 * ```
 */
export type IsLiteralUnion<V> = [V] extends [never]
  ? false
  : [V] extends [string | number]
    ? string extends V
      ? false
      : `${number}` extends `${V & number}`
        ? false
        : true
    : false;

/**
 * Values of an `enum` option: array elements, or the values of a TS enum object (numeric reverse mappings dropped).
 *
 * @example
 * ```ts
 * type V = EnumValues<readonly ["a", "b"]>; // "a" | "b"
 * ```
 */
type EnumValues<E> = E extends readonly (infer V)[] ? V : E extends object ? E[Exclude<keyof E, number>] : never;

/**
 * The value a `default` option produces: the result of a factory, or the value itself.
 *
 * @example
 * ```ts
 * type D = DefaultValue<() => number>; // number
 * ```
 */
type DefaultValue<D> = D extends () => infer R ? R : D;

/**
 * `true` when the option `Key` is present and not optional in `O`.
 *
 * @example
 * ```ts
 * type R = Has<{ enum: readonly ["a"] }, "enum">; // true
 * ```
 */
type Has<O, Key extends string> = Key extends keyof O ? (undefined extends O[Key & keyof O] ? false : true) : false;

/**
 * A failed rule.
 *
 * @example
 * ```ts
 * type E = PropError<"name", "the field is Immutable<T>, add immutable: true">;
 * ```
 */
export type PropError<Name extends string, Message extends string> = `@Prop "${Name}": ${Message}`;

/**
 * `true` when options `O` agree with the field `F` declared with spec `S`, otherwise a message.
 *
 * @example
 * ```ts
 * type R = PropCheck<"name", string, StringConstructor, { required: true }>; // true
 * ```
 */
export type PropCheck<Name extends string, F, S, O> = [S] extends [UnsupportedSpec]
  ? PropError<Name, "this type is not supported (no Set/Map/Array/Object: use [X], Spec.map(X) or a @Schema class)">
  : IsVirtualRef<F> extends true
    ? PropError<Name, "a VirtualRef field is declared with @Virtual, not @Prop">
    : IsVirtualValue<F> extends true
      ? PropError<Name, "Computed/VirtualValue are getters and accessors, not @Prop fields">
      : CheckRef<Name, F, S, O>;

/**
 * The model of a reference field: `Ref<M>`, `Ref<M>[]` or `Map<string, Ref<M>>`.
 *
 * @example
 * ```ts
 * type M = FieldRefModel<Ref<User>>; // User
 * ```
 */
type FieldRefModel<F> = NonNullable<F> extends ReadonlyMap<string, infer V> ? RefModel<V> : RefModel<F>;

/**
 * Rule 3: the reference options agree with the `Ref<M>` field type, then continues.
 *
 * @example
 * ```ts
 * type R = CheckRef<"author", Ref<User>, BsonClass<"ObjectId">, { ref: () => typeof User }>;
 * ```
 */
type CheckRef<Name extends string, F, S, O> = [FieldRefModel<F>] extends [never]
  ? Has<O, "ref"> extends true
    ? PropError<Name, `"ref" is set, but the field type is not Ref<Model>`>
    : Has<O, "refPath"> extends true
      ? PropError<Name, `"refPath" is set, but the field type is not Ref<Model>`>
      : Has<O, "refModel"> extends true
        ? PropError<Name, `"refModel" is set, but the field type is not Ref<Model>`>
        : CheckType<Name, F, S, O>
  : Has<O, "ref"> extends true
    ? O extends { readonly ref: () => EntityClass<infer M> }
      ? Same<M, FieldRefModel<F>> extends true
        ? CheckType<Name, F, S, O>
        : PropError<Name, `"ref" points to another model than the field's Ref<Model>`>
      : PropError<Name, `"ref" must be a thunk () => Model`>
    : Has<O, "refPath"> extends true
      ? CheckType<Name, F, S, O>
      : Has<O, "refModel"> extends true
        ? O extends { readonly refModel: (owner: never, id: never) => EntityClass<infer M> }
          ? Same<M, FieldRefModel<F>> extends true
            ? CheckType<Name, F, S, O>
            : PropError<Name, `"refModel" returns another model than the field's Ref<Model>`>
          : PropError<Name, `"refModel" must be (owner, id) => Model`>
        : PropError<Name, "the field is Ref<Model>, add ref: () => Model">;

/**
 * Rule 4: the runtime type produces exactly the field type, then continues.
 *
 * @example
 * ```ts
 * type R = CheckType<"name", string, StringConstructor, {}>;
 * ```
 */
type CheckType<Name extends string, F, S, O> = [CheckedValue<F>] extends [SpecValue<S>]
  ? [SpecValue<S>] extends [Widen<CheckedValue<F>>]
    ? CheckVector<Name, F, S, O>
    : IsSubclassUnion<CheckedValue<F>, SpecValue<S>> extends true
      ? CheckVector<Name, F, S, O>
      : PropError<Name, "the runtime type () => X is wider than the field type">
  : PropError<Name, "the runtime type () => X does not match the field type">;

/**
 * `true` when the value (an element of arrays, a value of Maps) is a `Vector` (`boolean` for a mix).
 *
 * @example
 * ```ts
 * type R = HasVector<Vector[]>; // true
 * ```
 */
type HasVector<V> = V extends readonly (infer E)[]
  ? HasVector<E>
  : V extends ReadonlyMap<string, infer M>
    ? HasVector<NonNullable<M>>
    : IsVector<V>;

/**
 * A vector and a binary are the same class, told apart by the `Vector` marker (their plain and JSON
 * forms differ: `number[]` against bytes). Assignability cannot see an optional marker, so it is
 * compared here.
 *
 * @example
 * ```ts
 * type R = CheckVector<"embedding", Vector, VectorSpec, {}>;
 * ```
 */
type CheckVector<Name extends string, F, S, O> =
  Same<HasVector<CheckedValue<F>>, HasVector<SpecValue<S>>> extends true
    ? CheckEnum<Name, F, S, O>
    : HasVector<SpecValue<S>> extends true
      ? PropError<Name, "Spec.vector(...) needs the field type Vector">
      : PropError<Name, "a Vector field needs Spec.vector({ dtype, dimensions })">;

/**
 * A reference's id is never a literal union: `Ref<M, number>` is `number & RefMarker<M>`, which the literal
 * test below took for a union of numeric literals (a template of a branded number is not `${number}`) and
 * asked for an `enum` (seen with Mongoose's Number `_id` tests).
 *
 * @example
 * ```ts
 * type C = EnumCandidate<Ref<User, number>>; // number
 * ```
 */
type EnumCandidate<E> = E extends RefMarker<unknown> ? (E extends number ? number : E extends string ? string : E) : E;

/**
 * Rule 5: a literal-union field and the `enum` option go together, then continues.
 *
 * @example
 * ```ts
 * type R = CheckEnum<"role", "a" | "b", StringConstructor, { enum: readonly ["a", "b"] }>;
 * ```
 */
type CheckEnum<Name extends string, F, S, O, E = ElementValue<CheckedValue<F>, S>> =
  IsLiteralUnion<EnumCandidate<E>> extends true
    ? Has<O, "enum"> extends true
      ? Same<EnumValues<O["enum" & keyof O]>, E> extends true
        ? CheckDefault<Name, F, O>
        : PropError<Name, `"enum" values differ from the field's literal union`>
      : PropError<Name, `the field is a literal union, list its members in "enum"`>
    : Has<O, "enum"> extends true
      ? PropError<Name, `"enum" needs a literal-union field type`>
      : CheckDefault<Name, F, O>;

/**
 * `true` when the field is an array: it starts as `[]` without a `default`, so a `default` does not change its
 * read or create form and needs no `Defaulted<T>`.
 *
 * @example
 * ```ts
 * type R = IsArrayField<string[]>; // true
 * ```
 */
type IsArrayField<F> = [NonNullable<F>] extends [readonly unknown[]] ? true : false;

/**
 * Rule 6: `default` goes with `Defaulted<T>` (an array field may omit the marker) and fits the field, then
 * continues.
 *
 * @example
 * ```ts
 * type R = CheckDefault<"n", Defaulted<number>, { default: 1 }>;
 * ```
 */
type CheckDefault<Name extends string, F, O> =
  Has<O, "default"> extends true
    ? IsDefaulted<F> extends true
      ? CheckDefaultValue<Name, F, O>
      : IsArrayField<F> extends true
        ? CheckDefaultValue<Name, F, O>
        : PropError<Name, `"default" is set, declare the field as Defaulted<T>`>
    : IsDefaulted<F> extends true
      ? PropError<Name, `the field is Defaulted<T>, but "default" is missing`>
      : CheckImmutable<Name, F, O>;

/**
 * The `default` value fits the field, then continues with rule 7.
 *
 * @example
 * ```ts
 * type R = CheckDefaultValue<"tags", string[], { default: () => [] }>;
 * ```
 */
type CheckDefaultValue<Name extends string, F, O> = [DefaultValue<O["default" & keyof O]>] extends [
  ReadonlyArrays<Unbranded<NonNullable<F>>> | (null extends F ? null : never),
]
  ? CheckImmutable<Name, F, O>
  : PropError<Name, `the "default" value does not fit the field type`>;

/**
 * Rule 7: `immutable` goes with `Immutable<T>`, then continues.
 *
 * @example
 * ```ts
 * type R = CheckImmutable<"n", Immutable<number>, { immutable: true }>;
 * ```
 */
type CheckImmutable<Name extends string, F, O> = O extends { readonly immutable: true }
  ? IsImmutable<F> extends true
    ? CheckHidden<Name, F, O>
    : PropError<Name, `"immutable" is set, declare the field as Immutable<T>`>
  : IsImmutable<F> extends true
    ? PropError<Name, "the field is Immutable<T>, add immutable: true">
    : CheckHidden<Name, F, O>;

/**
 * Rule 8: `hidden` goes with `Hidden<T>`, then continues.
 *
 * @example
 * ```ts
 * type R = CheckHidden<"n", Hidden<number>, { hidden: true }>;
 * ```
 */
type CheckHidden<Name extends string, F, O> = O extends { readonly hidden: true }
  ? IsHidden<F> extends true
    ? CheckNullable<Name, F, O>
    : PropError<Name, `"hidden" is set, declare the field as Hidden<T>`>
  : IsHidden<F> extends true
    ? PropError<Name, "the field is Hidden<T>, add hidden: true">
    : CheckNullable<Name, F, O>;

/**
 * Rule 9: `nullable` goes with `| null` in the field type; the last rule.
 *
 * @example
 * ```ts
 * type R = CheckNullable<"n", number | null, { nullable: true }>; // true
 * ```
 */
type CheckNullable<Name extends string, F, O> = O extends { readonly nullable: true }
  ? null extends F
    ? true
    : PropError<Name, `"nullable" is set, but the field type has no "| null"`>
  : null extends F
    ? PropError<Name, `the field type has "| null", add nullable: true`>
    : true;

/**
 * Element spec re-export for the decorators (array options apply per element).
 *
 * @example
 * ```ts
 * type E = PropElementSpec<[StringConstructor]>; // StringConstructor
 * ```
 */
export type PropElementSpec<S> = ElementSpec<S>;
