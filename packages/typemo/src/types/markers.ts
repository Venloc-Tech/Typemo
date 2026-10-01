import type { ObjectId } from "mongodb";

/*
 * Field markers: explicit, phantom, on `unique symbol` keys. They carry what the type of a field
 * cannot say by itself and what the decorators check against their options:
 *
 * | marker            | means                                              | option it pairs with     |
 * |-------------------|----------------------------------------------------|--------------------------|
 * | `Defaulted<T>`    | a value is supplied when absent                    | `default`                |
 * | `Immutable<T>`    | cannot change after the document is created        | `immutable: true`        |
 * | `Hidden<T>`       | not returned by queries unless selected            | `hidden: true`           |
 * | `Computed<T>`     | a get-only class getter (a virtual, not data)      | — (a native getter)      |
 * | `VirtualValue<T>` | a get/set accessor pair (a virtual, not data)      | — (native accessors)     |
 * | `Ref<M, Id>`      | an id of a document of model `M`                   | `ref: () => M`           |
 * | `VirtualRef<M,…>` | a populate virtual (no stored value)               | `@Virtual({ ref, … })`   |
 * | `TenantField<T>`  | the tenant field: filled by the core               | `@Schema({ tenant })`    |
 * | `Discriminators<C>` | the key of a base: its discriminator classes     | `@Schema({ discriminators })` |
 *
 * `readonly` is never a signal. Markers are optional members keyed by a `unique symbol`: they never
 * show in autocompletion and every `T` is assignable to `T & Marker`. `null` and `undefined` are never
 * marked: `Defaulted<string | null>` is `(string & DefaultedMarker) | null`.
 */

declare const DEFAULTED: unique symbol;
declare const IMMUTABLE: unique symbol;
declare const HIDDEN: unique symbol;
declare const COMPUTED: unique symbol;
declare const VIRTUAL_VALUE: unique symbol;
declare const REF_MODEL: unique symbol;
declare const VIRTUAL_REF_MODEL: unique symbol;
declare const VIRTUAL_REF_JUST_ONE: unique symbol;
declare const VIRTUAL_REF_COUNT: unique symbol;
declare const TENANT_FIELD: unique symbol;
declare const DISCRIMINATORS: unique symbol;

/**
 * Phantom member of `Defaulted<T>`.
 *
 * @example
 * type A = string & DefaultedMarker; // what `Defaulted<string>` is
 */
export interface DefaultedMarker {
  /** The phantom key; never present at run time. */
  readonly [DEFAULTED]?: true;
}

/**
 * Phantom member of `Immutable<T>`.
 *
 * @example
 * type A = string & ImmutableMarker; // what `Immutable<string>` is
 */
export interface ImmutableMarker {
  /** The phantom key; never present at run time. */
  readonly [IMMUTABLE]?: true;
}

/**
 * Phantom member of `Hidden<T>`.
 *
 * @example
 * type A = string & HiddenMarker; // what `Hidden<string>` is
 */
export interface HiddenMarker {
  /** The phantom key; never present at run time. */
  readonly [HIDDEN]?: true;
}

/**
 * Phantom member of `Computed<T>`.
 *
 * @example
 * type A = string & ComputedMarker; // what `Computed<string>` is
 */
export interface ComputedMarker {
  /** The phantom key; never present at run time. */
  readonly [COMPUTED]?: true;
}

/**
 * Phantom member of `VirtualValue<T>`.
 *
 * @example
 * type A = string & VirtualValueMarker; // what `VirtualValue<string>` is
 */
export interface VirtualValueMarker {
  /** The phantom key; never present at run time. */
  readonly [VIRTUAL_VALUE]?: true;
}

/**
 * Phantom member of `TenantField<T>`.
 *
 * @example
 * type A = string & TenantFieldMarker; // what `TenantField<string>` is
 */
export interface TenantFieldMarker {
  /** The phantom key; never present at run time. */
  readonly [TENANT_FIELD]?: true;
}

/**
 * Phantom member of `Ref<M, Id>`. The model sits in a tuple so that `infer` keeps it intact.
 *
 * @typeParam M - The referenced model.
 * @example
 * type A = ObjectId & RefMarker<User>; // what `Ref<User>` is
 */
export interface RefMarker<M> {
  /** The phantom key holding the model; never present at run time. */
  readonly [REF_MODEL]?: readonly [M];
}

/**
 * A value is supplied when the field is absent (option `default`, or filled by the core for service fields).
 *
 * @typeParam T - The field type; `null` and `undefined` stay unmarked.
 * @example
 * type A = Defaulted<string>; // string & DefaultedMarker
 * type B = Defaulted<string | null>; // (string & DefaultedMarker) | null
 */
export type Defaulted<T> = T extends null | undefined ? T : T & DefaultedMarker;

/**
 * The field cannot change after the document is created (option `immutable: true`).
 *
 * @typeParam T - The field type; `null` and `undefined` stay unmarked.
 * @example
 * type A = Immutable<Date>; // Date & ImmutableMarker
 */
export type Immutable<T> = T extends null | undefined ? T : T & ImmutableMarker;

/**
 * The type of a discriminator key declared on a discriminator class: `declare readonly __t:
 * DiscriminatorValue<"circle">`. Not a new marker — `Defaulted<Immutable<V>>`: the core writes it (optional in
 * `create`), it never changes (no update), and the lean/plain forms carry the literal `"circle"`.
 * The declaration is mandatory on every discriminator class; `@Discriminator("circle")` checks that the
 * declared literal is its value.
 *
 * @typeParam V - The discriminator value literal.
 * @example
 * class Circle extends Shape {
 *   declare readonly __t: DiscriminatorValue<"circle">;
 * }
 */
export type DiscriminatorValue<V extends string> = Defaulted<Immutable<V>>;

/**
 * The tenant field of a tenant-scoped schema (`@Schema({ tenant: true | { field } })`): the core fills
 * it from the operation's tenant, so `create()`/`insert*`/a replacement do not require it; every read form has it
 * (declare it `tenantId!: TenantField<string>`). `@Schema` checks that the marker sits exactly on the tenant field.
 * An update may write it only with the operation's own tenant (the policy checks the value at run time).
 *
 * @typeParam T - The field type; `null` and `undefined` stay unmarked.
 * @example
 * class Note {
 *   tenantId!: TenantField<string>;
 * }
 */
export type TenantField<T> = T extends null | undefined ? T : T & TenantFieldMarker;

/**
 * Phantom member of `Discriminators<C>`. The classes sit in a tuple so that `infer` keeps the union intact.
 *
 * @typeParam C - The discriminator classes (instance types).
 * @example
 * type A = string & DiscriminatorsMarker<Card | Transfer>; // part of what `Discriminators<Card | Transfer>` is
 */
export interface DiscriminatorsMarker<C> {
  /** The phantom key holding the classes; never present at run time. */
  readonly [DISCRIMINATORS]?: readonly [C];
}

/**
 * The type of the discriminator key declared on a BASE class that lists its discriminators
 * (`@Schema({ discriminators: () => [Card, Transfer] })`): `declare readonly __t?: Discriminators<Card | Transfer>`
 * (the base's `discriminatorKey` instead of `__t` when it has one). `@Schema` checks that the classes are the ones
 * of the option. The reads of the base model are then typed as the union of the base without a key and every
 * listed class, and `row.__t === "card"` narrows it. A discriminator class redeclares the key with its own
 * literal (`DiscriminatorValue<"card">`). The key is written by the core and never changes (`Immutable`).
 *
 * @typeParam C - The discriminator classes below the base (instance types), intermediates included.
 * @example
 * @Schema({ collection: "payments", discriminators: () => [Card, Transfer] })
 * class Payment extends Entity {
 *   declare readonly __t?: Discriminators<Card | Transfer>;
 * }
 */
export type Discriminators<C extends object> = string & DefaultedMarker & ImmutableMarker & DiscriminatorsMarker<C>;

/**
 * The field is left out of query results unless selected (option `hidden: true`, Mongoose `select: false`).
 *
 * @typeParam T - The field type; `null` and `undefined` stay unmarked.
 * @example
 * class User {
 *   passwordHash!: Hidden<string>;
 * }
 */
export type Hidden<T> = T extends null | undefined ? T : T & HiddenMarker;

/**
 * The return type of a get-only class getter: a computed virtual, never stored or written.
 *
 * @typeParam T - The getter's value type; `null` and `undefined` stay unmarked.
 * @example
 * class User {
 *   get fullName(): Computed<string> {
 *     return "a b" as Computed<string>;
 *   }
 * }
 */
export type Computed<T> = T extends null | undefined ? T : T & ComputedMarker;

/**
 * The type of a get/set accessor pair: a virtual value that can be assigned, never stored.
 *
 * @typeParam T - The accessor's value type; `null` and `undefined` stay unmarked.
 * @example
 * type A = VirtualValue<string>; // string & VirtualValueMarker
 */
export type VirtualValue<T> = T extends null | undefined ? T : T & VirtualValueMarker;

/**
 * An id of a document of model `M` (populatable). `Id` is the type of `M`'s `_id` (default `ObjectId`).
 *
 * @typeParam M - The referenced model.
 * @typeParam Id - The type of the referenced `_id`.
 * @example
 * class Post {
 *   author!: Ref<User>;
 * }
 */
export type Ref<M extends object, Id = ObjectId> = Id & RefMarker<M>;

/**
 * A populate virtual (`@Virtual({ ref: () => M, localField, foreignField, justOne, count })`): the
 * property holds nothing until populated. `JustOne` and `Count` must equal the options.
 *
 * @typeParam M - The referenced model.
 * @typeParam JustOne - Whether the virtual resolves to one document instead of a list.
 * @typeParam Count - Whether the virtual resolves to a count.
 * @example
 * class User {
 *   posts!: VirtualRef<Post>; // populates to Post[]
 *   latest!: VirtualRef<Post, true>; // populates to one Post
 * }
 */
export interface VirtualRef<M extends object, JustOne extends boolean = false, Count extends boolean = false> {
  /** The phantom key holding the model. */
  readonly [VIRTUAL_REF_MODEL]?: readonly [M];
  /** The phantom key holding the `justOne` flag. */
  readonly [VIRTUAL_REF_JUST_ONE]?: JustOne;
  /** The phantom key holding the `count` flag. */
  readonly [VIRTUAL_REF_COUNT]?: Count;
}

/**
 * `true` when `Key` is a key of `T` (per union member).
 *
 * @typeParam T - The type to test.
 * @typeParam Key - The key to look for.
 * @example
 * type A = HasKey<{ a: 1 }, "a">; // true
 * type B = HasKey<{ a: 1 }, "b">; // false
 */
type HasKey<T, Key extends PropertyKey> = T extends unknown ? (Key extends keyof T ? true : false) : never;

/**
 * `true` when the field type carries the `Defaulted` marker.
 *
 * @typeParam F - The field type.
 * @example
 * type A = IsDefaulted<Defaulted<string>>; // true
 * type B = IsDefaulted<string>; // false
 */
export type IsDefaulted<F> = true extends HasKey<NonNullable<F>, typeof DEFAULTED> ? true : false;
/**
 * `true` when the field type carries the `Immutable` marker.
 *
 * @typeParam F - The field type.
 * @example
 * type A = IsImmutable<Immutable<Date>>; // true
 */
export type IsImmutable<F> = true extends HasKey<NonNullable<F>, typeof IMMUTABLE> ? true : false;
/**
 * `true` when the field type carries the `TenantField` marker.
 *
 * @typeParam F - The field type.
 * @example
 * type A = IsTenantField<TenantField<string>>; // true
 */
export type IsTenantField<F> = true extends HasKey<NonNullable<F>, typeof TENANT_FIELD> ? true : false;
/**
 * `true` when the field type carries the `Hidden` marker.
 *
 * @typeParam F - The field type.
 * @example
 * type A = IsHidden<Hidden<string>>; // true
 */
export type IsHidden<F> = true extends HasKey<NonNullable<F>, typeof HIDDEN> ? true : false;
/**
 * `true` when the type is a `Computed` or `VirtualValue` virtual.
 *
 * @typeParam F - The field type.
 * @example
 * type A = IsVirtualValue<Computed<string>>; // true
 * type B = IsVirtualValue<string>; // false
 */
export type IsVirtualValue<F> = true extends
  | HasKey<NonNullable<F>, typeof COMPUTED>
  | HasKey<NonNullable<F>, typeof VIRTUAL_VALUE>
  ? true
  : false;

/**
 * The model of a `Ref<M>` field (or of `Ref<M>[]`), `never` for other types.
 *
 * @typeParam F - The field type.
 * @example
 * type A = RefModel<Ref<User>>; // User
 * type B = RefModel<Ref<User>[]>; // User
 * type C = RefModel<string>; // never
 */
export type RefModel<F> =
  NonNullable<F> extends readonly (infer E)[] ? RefModelOf<NonNullable<E>> : RefModelOf<NonNullable<F>>;
/**
 * The model of one `Ref` value, `never` for an untyped one.
 *
 * @typeParam V - The value type.
 * @example
 * type A = RefModelOf<Ref<User>>; // User
 */
type RefModelOf<V> = V extends RefMarker<infer M> ? (unknown extends M ? never : M) : never;

/**
 * The model of a `VirtualRef<M>` field, `never` for other types.
 *
 * @typeParam F - The field type.
 * @example
 * type A = VirtualRefModel<VirtualRef<Post>>; // Post
 */
export type VirtualRefModel<F> =
  NonNullable<F> extends { readonly [VIRTUAL_REF_MODEL]?: readonly [infer M] }
    ? unknown extends M
      ? never
      : M
    : never;
/**
 * The `JustOne` flag of a `VirtualRef` (`false` when absent).
 *
 * @typeParam F - The field type.
 * @example
 * type A = VirtualRefJustOne<VirtualRef<Post, true>>; // true
 */
export type VirtualRefJustOne<F> =
  NonNullable<F> extends { readonly [VIRTUAL_REF_JUST_ONE]?: infer J extends boolean } ? J : false;
/**
 * The `Count` flag of a `VirtualRef` (`false` when absent).
 *
 * @typeParam F - The field type.
 * @example
 * type A = VirtualRefCount<VirtualRef<Post, false, true>>; // true
 */
export type VirtualRefCount<F> =
  NonNullable<F> extends { readonly [VIRTUAL_REF_COUNT]?: infer C extends boolean } ? C : false;
/**
 * `true` for a `VirtualRef` field.
 *
 * @typeParam F - The field type.
 * @example
 * type A = IsVirtualRef<VirtualRef<Post>>; // true
 * type B = IsVirtualRef<string>; // false
 */
export type IsVirtualRef<F> = [VirtualRefModel<F>] extends [never] ? false : true;

/**
 * Removes marker `M` when present. The presence test matters: a marker interface has only optional
 * members, so `V extends infer P & M` also matches a `V` WITHOUT the marker (inferring `P = V`),
 * and a chain of such strips would stop at the first one.
 *
 * @typeParam V - The value type.
 * @typeParam M - The marker interface to remove.
 * @typeParam Present - Whether `V` carries the marker.
 * @example
 * type A = StripMarker<string & HiddenMarker, HiddenMarker, true>; // string
 */
type StripMarker<V, M, Present> = Present extends true ? (V extends infer P & M ? P : V) : V;

/**
 * Removes every marker of the older set (all but `TenantField`).
 *
 * @typeParam V - The value type.
 * @example
 * type A = StripAll<Defaulted<Hidden<string>>>; // string
 */
type StripAll<V> = StripMarker<
  StripMarker<
    StripMarker<
      StripMarker<StripMarker<V, DefaultedMarker, IsDefaulted<V>>, ImmutableMarker, IsImmutable<V>>,
      HiddenMarker,
      IsHidden<V>
    >,
    ComputedMarker,
    true extends HasKey<V, typeof COMPUTED> ? true : false
  >,
  VirtualValueMarker,
  true extends HasKey<V, typeof VIRTUAL_VALUE> ? true : false
>;

/**
 * `StripAll` plus the `TenantField` and `Discriminators` markers.
 *
 * @typeParam V - The value type.
 * @example
 * type A = StripAllTenant<TenantField<string>>; // string
 */
type StripAllTenant<V> = StripMarker<
  StripMarker<StripAll<V>, TenantFieldMarker, true extends HasKey<V, typeof TENANT_FIELD> ? true : false>,
  DiscriminatorsMarker<unknown>,
  true extends HasKey<V, typeof DISCRIMINATORS> ? true : false
>;

/**
 * The discriminator classes a `Discriminators<C>` key names, `never` for any other type.
 *
 * @typeParam F - The field type.
 * @example
 * type A = DiscriminatorsOf<Discriminators<Card | Transfer>>; // Card | Transfer
 * type B = DiscriminatorsOf<string>; // never
 */
export type DiscriminatorsOf<F> =
  NonNullable<F> extends { readonly [DISCRIMINATORS]?: readonly [infer C] } ? (unknown extends C ? never : C) : never;

/**
 * The key of `T` declared `Discriminators<C>` (`never` when `T` lists no discriminators). `__t` is looked at first:
 * the scan of every key runs only for a custom key.
 *
 * @typeParam T - The entity type.
 * @example
 * type A = DiscriminatorsKey<Payment>; // "__t"
 */
export type DiscriminatorsKey<T> = "__t" extends keyof T
  ? [DiscriminatorsOf<T["__t" & keyof T]>] extends [never]
    ? never
    : "__t"
  : { [K in keyof T]-?: [DiscriminatorsOf<T[K]>] extends [never] ? never : K }[keyof T];

/**
 * The value type without the field markers (`Defaulted`, `Immutable`, `Hidden`, `Computed`,
 * `VirtualValue`, `TenantField`), one union member at a time and **not recursively** (a recursive strip
 * inside a flattening type hits TS2589). Marker removal goes through intersection inference,
 * which keeps TS enum members intact (a template-literal strip would turn `Color.Red` into `"red"`).
 * `Ref` is kept: it is part of the value's meaning.
 *
 * @typeParam V - The value type.
 * @example
 * type A = Unbranded<Hidden<string> | null>; // string | null
 * type B = Unbranded<Ref<User>>; // Ref<User> (kept)
 */
export type Unbranded<V> = V extends unknown ? StripAllTenant<V> : never;
