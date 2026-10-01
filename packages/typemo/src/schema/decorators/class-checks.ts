import type { Subdocument } from "../../document/collections/hydrated-types.ts";
import type { HydratedDoc } from "../../document/document-types.ts";
import type { DocumentHookEvent, HookPhase, HookThisOf } from "../../hooks/hook-events.ts";
import type {
  DiscriminatorsKey,
  DiscriminatorsOf,
  IsDefaulted,
  IsImmutable,
  IsTenantField,
  Unbranded,
  VirtualRefCount,
  VirtualRefJustOne,
  VirtualRefModel,
} from "../../types/markers.ts";
import type { DataKeys, KeysOfType, SchemaPaths } from "../../types/schema-paths.ts";
import type { SchemaExtensions } from "../extensions/extension-registry.ts";
import type { SchemaOptions } from "../options/schema-options.ts";
import type { EntityClass } from "../options/type-spec.ts";

/*
 * Type checks of the class-level decorators: the check sits in the parameter
 * (`target: C & Check<C, …>`), so `C` is inferred from the class itself and no explicit `<User>` is
 * needed; a failed check is a required member the class lacks, whose name is the message. An
 * F-bounded constraint (`C extends Check<C>`) gives TS2313 instead.
 */

/**
 * The error carrier: a required member whose name is the message.
 *
 * @example
 * ```ts
 * type E = ClassError<"@Index: \"x\" is not a field of the class">;
 * ```
 */
export type ClassError<Message extends string> = { readonly [K in Message]: true };

/**
 * The instance type of a class.
 *
 * @example
 * ```ts
 * type I = Instance<typeof User>; // User
 * ```
 */
type Instance<C> = C extends EntityClass<infer I> ? I : never;

/**
 * Index keys may be paths or wildcards (`$**`, `path.$**`).
 *
 * @example
 * ```ts
 * type K = IndexKey<{ name: string }>; // "name" | "$**" | "name.$**"
 * ```
 */
type IndexKey<I> = SchemaPaths<I> | "$**" | `${SchemaPaths<I>}.$**`;

/**
 * The keys of `Keys` that are not in `Allowed`.
 *
 * @example
 * ```ts
 * type U = UnknownKeys<"a" | "b", "a">; // "b"
 * ```
 */
type UnknownKeys<Keys, Allowed> = Exclude<Keys & string, Allowed>;

/**
 * Keys used by a partial filter, through `$and` / `$or`.
 *
 * @example
 * ```ts
 * type K = FilterKeys<{ $and: [{ age: 1 }, { active: true }] }>; // "age" | "active"
 * ```
 */
type FilterKeys<F> = F extends readonly (infer E)[]
  ? FilterKeys<E>
  : F extends object
    ? { [K in keyof F & string]: K extends "$and" | "$or" ? FilterKeys<F[K]> : K }[keyof F & string]
    : never;

/**
 * Checks the `weights` keys of an index, then continues with the wildcard check.
 *
 * @example
 * ```ts
 * type R = CheckWeights<User, { weights: { name: 2 } }>; // unknown
 * ```
 */
type CheckWeights<I, O> = O extends { readonly weights: infer W }
  ? [UnknownKeys<keyof W, SchemaPaths<I>>] extends [never]
    ? CheckWildcard<I, O>
    : ClassError<`@Index: weights."${UnknownKeys<keyof W, SchemaPaths<I>>}" is not a field of the class`>
  : CheckWildcard<I, O>;

/**
 * Checks the `wildcardProjection` keys of an index.
 *
 * @example
 * ```ts
 * type R = CheckWildcard<User, { wildcardProjection: { name: 1 } }>; // unknown
 * ```
 */
type CheckWildcard<I, O> = O extends { readonly wildcardProjection: infer W }
  ? [UnknownKeys<keyof W, SchemaPaths<I>>] extends [never]
    ? unknown
    : ClassError<`@Index: wildcardProjection."${UnknownKeys<keyof W, SchemaPaths<I>>}" is not a field of the class`>
  : unknown;

/**
 * Checks the `partialFilterExpression` keys of an index, then continues with the weights check.
 *
 * @example
 * ```ts
 * type R = CheckPartial<User, { partialFilterExpression: { age: { $gt: 1 } } }>; // unknown
 * ```
 */
type CheckPartial<I, O> = O extends { readonly partialFilterExpression: infer P }
  ? [UnknownKeys<FilterKeys<P>, SchemaPaths<I>>] extends [never]
    ? CheckWeights<I, O>
    : ClassError<`@Index: partialFilterExpression "${UnknownKeys<FilterKeys<P>, SchemaPaths<I>>}" is not a field of the class`>
  : CheckWeights<I, O>;

/**
 * `unknown` when every path in the index keys and options is a path of the class.
 *
 * @example
 * ```ts
 * type R = IndexCheck<typeof User, { name: 1 }, { unique: true }>; // unknown
 * ```
 */
export type IndexCheck<C, F, O> = [UnknownKeys<keyof F, IndexKey<Instance<C>>>] extends [never]
  ? CheckPartial<Instance<C>, O>
  : ClassError<`@Index: "${UnknownKeys<keyof F, IndexKey<Instance<C>>>}" is not a field of the class`>;

/* --- @Discriminator --- */

/**
 * The declared type of the `__t` key, without brands.
 *
 * @example
 * ```ts
 * type K = DeclaredKey<{ __t: DiscriminatorValue<"circle"> }>; // "circle"
 * ```
 */
type DeclaredKey<I> = "__t" extends keyof I ? Unbranded<NonNullable<I["__t" & keyof I]>> : never;

/**
 * A string literal (not `string`), else `never`.
 *
 * @example
 * ```ts
 * type L = StringLiteral<"a">; // "a"
 * ```
 */
type StringLiteral<X> = X extends string ? (string extends X ? never : X) : never;

/**
 * The literals of the class's `DiscriminatorValue<"…">` declarations: members that are `Defaulted` and
 * `Immutable` string literals, that is `__t` or a custom `discriminatorKey` (the decorator cannot see
 * the base's option, so the key is recognized by its type).
 *
 * @example
 * ```ts
 * type V = DeclaredValues<{ __t: DiscriminatorValue<"circle"> }>; // "circle"
 * ```
 */
type DeclaredValues<I> = {
  [K in keyof I]-?: IsDefaulted<I[K]> extends true
    ? IsImmutable<I[K]> extends true
      ? StringLiteral<Unbranded<NonNullable<I[K]>>>
      : never
    : never;
}[keyof I];

/**
 * The error for a discriminator class that does not declare its key.
 *
 * @example
 * ```ts
 * type E = MissingDeclaration<"circle">;
 * ```
 */
type MissingDeclaration<V extends string> =
  ClassError<`@Discriminator("${V}"): declare the discriminator key with its value in the class — declare readonly __t: DiscriminatorValue<"${V}"> (or your discriminatorKey instead of __t)`>;

/**
 * A discriminator class MUST declare its key with the literal value, `declare readonly __t:
 * DiscriminatorValue<"circle">` (or the base's `discriminatorKey`), so that the lean, plain and hydrated
 * types carry the literal and a union of discriminators narrows by it. `unknown` when the declaration is
 * there with the decorator's value; otherwise a readable error: no declaration, another literal, or no
 * literal value given (the default, the class name, is not known to the type). A nested discriminator's
 * intermediate class declares the union of its own value and its sub-discriminators'
 * (`DiscriminatorValue<"mid" | "leaf">`): a subclass may only narrow the declared type (TS2416), and the
 * decorator's value must be one of them.
 *
 * @example
 * ```ts
 * @Schema({ collection: "shapes" })
 * class Shape extends Entity {}
 * @Discriminator("circle")
 * class Circle extends Shape {
 *   declare readonly __t: DiscriminatorValue<"circle">;
 * }
 * type R = DiscriminatorCheck<typeof Circle, "circle">; // unknown
 * ```
 */
export type DiscriminatorCheck<C, V extends string> = string extends V
  ? ClassError<`@Discriminator(): pass the value as a literal — @Discriminator("value") with declare readonly __t: DiscriminatorValue<"value"> (the class-name default cannot be checked by the type)`>
  : [V] extends [DeclaredValues<Instance<C>>]
    ? unknown
    : [DeclaredKey<Instance<C>>] extends [never]
      ? MissingDeclaration<V>
      : string extends DeclaredKey<Instance<C>>
        ? MissingDeclaration<V>
        : ClassError<`@Discriminator: the class declares __t as "${DeclaredKey<Instance<C>> & string}", but the value is "${V}"`>;

/* --- @Schema --- */

/**
 * Checks that `timeseries.timeField` is a `Date` field of the class, then continues down the chain.
 *
 * @example
 * ```ts
 * type R = CheckTimeField<Reading, { timeseries: { timeField: "at" } }>; // unknown
 * ```
 */
type CheckTimeField<I, O> = O extends { readonly timeseries: { readonly timeField: infer TF extends string } }
  ? TF extends KeysOfType<I, Date>
    ? CheckMetaField<I, O>
    : ClassError<`@Schema: timeseries.timeField "${TF}" is not a Date field of the class`>
  : CheckMetaField<I, O>;

/**
 * Checks that `timeseries.metaField` is a field of the class other than `_id`, then continues.
 *
 * @example
 * ```ts
 * type R = CheckMetaField<Reading, { timeseries: { metaField: "sensor" } }>; // unknown
 * ```
 */
type CheckMetaField<I, O> = O extends { readonly timeseries: { readonly metaField: infer MF extends string } }
  ? MF extends Exclude<DataKeys<I>, "_id">
    ? CheckDiscriminatorKey<I, O>
    : ClassError<`@Schema: timeseries.metaField "${MF}" is not a field of the class (and not _id)`>
  : CheckDiscriminatorKey<I, O>;

/**
 * Checks that `discriminatorKey` is a string field of the class, then continues.
 *
 * @example
 * ```ts
 * type R = CheckDiscriminatorKey<Shape, { discriminatorKey: "kind" }>; // unknown
 * ```
 */
type CheckDiscriminatorKey<I, O> = O extends { readonly discriminatorKey: infer DK extends string }
  ? DK extends KeysOfType<I, string>
    ? CheckDiscriminators<I, O>
    : ClassError<`@Schema: discriminatorKey "${DK}" is not a string field of the class`>
  : CheckDiscriminators<I, O>;

/**
 * The discriminator key of the options: `discriminatorKey`, else `__t`.
 *
 * @example
 * ```ts
 * type K = OptionKey<{ discriminatorKey: "kind" }>; // "kind"
 * ```
 */
type OptionKey<O> = O extends { readonly discriminatorKey: infer K extends string } ? K : "__t";

/**
 * The instance types of the `discriminators` list.
 *
 * @example
 * ```ts
 * type C = ListedClasses<{ discriminators: () => readonly [typeof Card, typeof Transfer] }>; // Card | Transfer
 * ```
 */
type ListedClasses<O> = O extends { readonly discriminators: () => readonly (infer C)[] }
  ? C extends abstract new () => infer I
    ? I
    : never
  : never;

/**
 * Checks that the `discriminators` option and the key declared `Discriminators<C>` name the same classes (a class
 * missing from both is found by the schema build), then continues.
 *
 * @example
 * ```ts
 * type R = CheckDiscriminators<Payment, { discriminators: () => readonly [typeof Card] }>; // unknown
 * ```
 */
type CheckDiscriminators<I, O> = O extends { readonly discriminators: unknown }
  ? [DiscriminatorsOf<I[OptionKey<O> & keyof I]>] extends [never]
    ? ClassError<`@Schema: declare the discriminator key with the listed classes — declare readonly ${OptionKey<O>}?: Discriminators<A | B>`>
    : [DiscriminatorsOf<I[OptionKey<O> & keyof I]>] extends [ListedClasses<O>]
      ? [ListedClasses<O>] extends [DiscriminatorsOf<I[OptionKey<O> & keyof I]>]
        ? CheckTenant<I, O>
        : ClassError<`@Schema: the classes of ${OptionKey<O>}: Discriminators<…> differ from the "discriminators" list`>
      : ClassError<`@Schema: the classes of ${OptionKey<O>}: Discriminators<…> differ from the "discriminators" list`>
  : [DiscriminatorsKey<I>] extends [never]
    ? CheckTenant<I, O>
    : ClassError<`@Schema: "${DiscriminatorsKey<I> & string}" is Discriminators<…>, but the schema has no "discriminators" option — add discriminators: () => [A, B]`>;

/**
 * The field a policy option (`tenant`, `softDelete`) names: the explicit `field`, the default for
 * `true` or an object, `never` when the option is absent.
 *
 * @example
 * ```ts
 * type F = PolicyField<{ tenant: true }, "tenant", "tenantId">; // "tenantId"
 * ```
 */
type PolicyField<O, Name extends string, Default extends string> = O extends {
  readonly [K in Name]: { readonly field: infer F extends string };
}
  ? F
  : O extends { readonly [K in Name]: true | object }
    ? Default
    : never;

/**
 * The keys declared `TenantField<T>`.
 *
 * @example
 * ```ts
 * type K = TenantKeys<{ tenantId: TenantField<string> }>; // "tenantId"
 * ```
 */
type TenantKeys<I> = { [K in keyof I]-?: IsTenantField<I[K]> extends true ? K : never }[keyof I] & string;

/**
 * Checks that the tenant option and the `TenantField<T>` declarations agree, then continues.
 *
 * @example
 * ```ts
 * type R = CheckTenant<Doc, { tenant: true }>;
 * ```
 */
type CheckTenant<I, O> = [PolicyField<O, "tenant", "tenantId">] extends [never]
  ? [TenantKeys<I>] extends [never]
    ? CheckSoftDelete<I, O>
    : ClassError<`@Schema: "${TenantKeys<I>}" is TenantField<T>, but the schema has no tenant option — add tenant: { field: "${TenantKeys<I>}" } or use a plain type`>
  : PolicyField<O, "tenant", "tenantId"> extends DataKeys<I>
    ? IsTenantField<I[PolicyField<O, "tenant", "tenantId"> & keyof I]> extends true
      ? [Exclude<TenantKeys<I>, PolicyField<O, "tenant", "tenantId">>] extends [never]
        ? CheckSoftDelete<I, O>
        : ClassError<`@Schema: "${Exclude<TenantKeys<I>, PolicyField<O, "tenant", "tenantId">>}" is TenantField<T>, but the tenant field is "${PolicyField<O, "tenant", "tenantId">}"`>
      : ClassError<`@Schema: declare the tenant field as ${PolicyField<O, "tenant", "tenantId">}!: TenantField<T> — the core fills it, create() does not require it, reads always have it`>
    : ClassError<`@Schema: tenant field "${PolicyField<O, "tenant", "tenantId">}" is not a field of the class`>;

/**
 * Checks that the soft delete field is a `Date` field of the class, then continues.
 *
 * @example
 * ```ts
 * type R = CheckSoftDelete<Doc, { softDelete: true }>;
 * ```
 */
type CheckSoftDelete<I, O> = [PolicyField<O, "softDelete", "deletedAt">] extends [never]
  ? CheckConcurrency<I, O>
  : PolicyField<O, "softDelete", "deletedAt"> extends KeysOfType<I, Date>
    ? CheckConcurrency<I, O>
    : ClassError<`@Schema: softDelete field "${PolicyField<O, "softDelete", "deletedAt">}" is not a Date | null field of the class`>;

/**
 * The paths an `optimisticConcurrency` list may name: paths of the class, a Map field's values as `field.$*`.
 *
 * @example
 * ```ts
 * type P = ConcurrencyPath<{ settings: Map<string, string> }>; // includes "settings.$*"
 * ```
 */
type ConcurrencyPath<I> = SchemaPaths<I> | `${KeysOfType<I, ReadonlyMap<string, unknown>> & string}.$*`;

/**
 * Checks that the `optimisticConcurrency` path list names only paths of the class.
 *
 * @example
 * ```ts
 * type R = CheckConcurrency<Account, { optimisticConcurrency: ["balance"] }>; // unknown
 * ```
 */
type CheckConcurrency<I, O> = O extends { readonly optimisticConcurrency: readonly (infer P)[] }
  ? [Exclude<P, ConcurrencyPath<I>>] extends [never]
    ? unknown
    : ClassError<`@Schema: optimisticConcurrency names "${Exclude<P, ConcurrencyPath<I>> & string}", which is not a path of the class`>
  : unknown;

/**
 * Rejects an option `@Schema` does not have (a typo, or `toJSON`/`toObject`: serialization options are
 * given to each call). The options are a `const` type parameter, so the compiler would not report an
 * excess key itself.
 *
 * @example
 * ```ts
 * type R = CheckOptionKeys<User, { collection: "users" }>; // unknown
 * ```
 */
type CheckOptionKeys<I, O> = [Exclude<keyof O, keyof SchemaOptions>] extends [never]
  ? CheckExtensionKeys<O, CheckTimeField<I, O>>
  : Exclude<keyof O, keyof SchemaOptions> extends "toJSON" | "toObject"
    ? ClassError<"@Schema has no toJSON/toObject options: pass them to each $toJSON()/$toObject()/$toPlain() call">
    : ClassError<`@Schema: "${Exclude<keyof O, keyof SchemaOptions> & string}" is not an option of @Schema`>;

/**
 * An `ext` key no extension declared (`SchemaExtensions`) is a class error.
 *
 * @example
 * ```ts
 * type R = CheckExtensionKeys<{ ext: { unknown: 1 } }, unknown>; // a ClassError
 * ```
 */
type CheckExtensionKeys<O, R> = O extends { readonly ext: infer E }
  ? [Exclude<keyof E, keyof SchemaExtensions>] extends [never]
    ? R
    : ClassError<`@Schema: ext "${Exclude<keyof E, keyof SchemaExtensions> & string}" is not a registered extension (SchemaExtensions)`>
  : R;

/**
 * `unknown` when the options are options of `@Schema` and their field names exist on the class with the right types.
 *
 * @example
 * ```ts
 * type R = SchemaCheck<typeof User, { collection: "users" }>; // unknown
 * ```
 */
export type SchemaCheck<C, O> = CheckOptionKeys<Instance<C>, O>;

/* --- @Virtual --- */

/**
 * The error carrier of a `@Virtual` check: an object at the field key, so the field type cannot satisfy it.
 *
 * @example
 * ```ts
 * type E = VirtualError<"posts", "declare the field as VirtualRef<Model, JustOne, Count>">;
 * ```
 */
type VirtualError<K extends string, M extends string> = {
  readonly [P in K]: { readonly typemoError: `@Virtual "${K}": ${M}` };
};

/**
 * Checks `justOne` against the field's `VirtualRef<M, JustOne>`, then continues.
 *
 * @example
 * ```ts
 * type R = CheckVirtualFlags<User, "posts", { justOne: true }, VirtualRef<Post, true>>;
 * ```
 */
type CheckVirtualFlags<T, K extends string, O, F> = O extends { readonly justOne: infer J }
  ? [J] extends [VirtualRefJustOne<F>]
    ? CheckVirtualCount<T, K, O, F>
    : VirtualError<K, `"justOne" differs from the field's VirtualRef<M, JustOne>`>
  : [VirtualRefJustOne<F>] extends [false]
    ? CheckVirtualCount<T, K, O, F>
    : VirtualError<K, `the field is VirtualRef<M, true>, add justOne: true`>;

/**
 * Checks `count` against the field's `VirtualRef<M, JustOne, Count>`, then continues.
 *
 * @example
 * ```ts
 * type R = CheckVirtualCount<User, "posts", { count: true }, VirtualRef<Post, false, true>>;
 * ```
 */
type CheckVirtualCount<T, K extends string, O, F> = O extends { readonly count: infer N }
  ? [N] extends [VirtualRefCount<F>]
    ? CheckVirtualPaths<T, K, O, F>
    : VirtualError<K, `"count" differs from the field's VirtualRef<M, JustOne, Count>`>
  : [VirtualRefCount<F>] extends [false]
    ? CheckVirtualPaths<T, K, O, F>
    : VirtualError<K, `the field is VirtualRef<M, J, true>, add count: true`>;

/**
 * Checks `localField`, `foreignField` and `match` keys against the two classes.
 *
 * @example
 * ```ts
 * type R = CheckVirtualPaths<User, "posts", { localField: "_id"; foreignField: "author" }, VirtualRef<Post>>;
 * ```
 */
type CheckVirtualPaths<T, K extends string, O, F> = O extends { readonly localField: infer L extends string }
  ? L extends SchemaPaths<T>
    ? O extends { readonly foreignField: infer R extends string }
      ? R extends SchemaPaths<VirtualRefModel<F>>
        ? O extends { readonly match: infer Mt }
          ? [UnknownKeys<keyof Mt, SchemaPaths<VirtualRefModel<F>>>] extends [never]
            ? unknown
            : VirtualError<
                K,
                `match."${UnknownKeys<keyof Mt, SchemaPaths<VirtualRefModel<F>>>}" is not a field of the referenced class`
              >
          : unknown
        : VirtualError<K, `foreignField "${R}" is not a field of the referenced class`>
      : unknown
    : VirtualError<K, `localField "${L}" is not a field of this class`>
  : unknown;

/**
 * `unknown` when the `@Virtual` options agree with the field's `VirtualRef<M, JustOne, Count>`.
 *
 * @example
 * ```ts
 * type R = VirtualCheck<User, "posts", { ref: () => typeof Post; localField: "_id"; foreignField: "author" }>;
 * ```
 */
export type VirtualCheck<T, K extends string, O> = K extends keyof T
  ? [VirtualRefModel<T[K]>] extends [never]
    ? VirtualError<K, "declare the field as VirtualRef<Model, JustOne, Count>">
    : O extends { readonly ref: () => EntityClass<infer M> }
      ? [M] extends [VirtualRefModel<T[K]>]
        ? [VirtualRefModel<T[K]>] extends [M]
          ? CheckVirtualFlags<T, K, O, T[K]>
          : VirtualError<K, `"ref" points to another model than the field's VirtualRef<Model>`>
        : VirtualError<K, `"ref" points to another model than the field's VirtualRef<Model>`>
      : VirtualError<K, `"ref" must be a thunk () => Model`>
  : VirtualError<K, "not a public field">;

/* --- @Tenant --- */

/**
 * `unknown` when the field `K` of `T` is declared `TenantField<T>`, otherwise an object carrier at the field key
 * that the field type cannot satisfy (the message is shown at the decorator). Whether the schema has the tenant
 * policy and names this field is checked by `@Schema` (types) and by the schema build (run time).
 *
 * @example
 * ```ts
 * type R = TenantCheck<{ tenantId: TenantField<string> }, "tenantId">; // unknown
 * ```
 */
export type TenantCheck<T, K extends string> = K extends keyof T
  ? IsTenantField<T[K]> extends true
    ? unknown
    : { readonly [P in K]: { readonly typemoError: `@Tenant "${K}": declare the field as TenantField<T>` } }
  : {
      readonly [P in K]: {
        readonly typemoError: `@Tenant "${K}": not a public field (private and protected fields cannot be schema fields)`;
      };
    };

/* --- hooks --- */

/**
 * `unknown` when the method fits the event: document hooks may leave `this` implicit or declare what the hook may
 * run with — the hydrated document or subdocument (`this: HydratedDoc<User> | Subdocument<User>`, which is
 * `HookThis<"document.save", User>`), the class (`this: User`) or, for a class only embedded, `this:
 * Subdocument<User>`. `this: HydratedDoc<User>` alone is refused: the class may be embedded, and a subdocument has
 * no `$getChanges()`, `$save()`, …. Every other scope must declare `this` explicitly (an implicit `this` would be
 * the entity while the hook actually runs with the operation context, see `HookThisOf`).
 *
 * @example
 * ```ts
 * type R = HookCheck<"document.save", User, (this: HydratedDoc<User> | Subdocument<User>) => void>; // unknown
 * ```
 */
export type HookCheck<E, T, M, P extends HookPhase = HookPhase> = [ThisParameterType<M>] extends [unknown]
  ? unknown extends ThisParameterType<M>
    ? [HookEventsOf<E>] extends [DocumentHookEvent]
      ? unknown
      : { readonly typemoError: "a query/model/aggregate hook must declare this: OperationHookContext<Entity>" }
    : [HookThisOf<E, T>] extends [ThisParameterType<M>]
      ? unknown
      : [HookEventsOf<E>] extends [DocumentHookEvent]
        ? [T] extends [ThisParameterType<M>]
          ? unknown
          : [Subdocument<T>] extends [ThisParameterType<M>]
            ? unknown
            : /* `this: HydratedDoc<Entity>`: the hook of the class also runs on its subdocuments. */
              [ThisParameterType<M>] extends [HydratedDoc<T>]
              ? {
                  readonly typemoError: `@${PhaseDecorator<P>}(${EventsText<E>}): a document hook may also run on a subdocument of the class; declare this as HydratedDoc<Entity> | Subdocument<Entity>, or narrow with if (this.$isRoot())`;
                }
              : DeclaredThisError
        : DeclaredThisError
  : unknown;

/**
 * The decorator name of a hook phase, for error texts.
 *
 * @example
 * ```ts
 * type N = PhaseDecorator<"postError">; // "PostError"
 * ```
 */
type PhaseDecorator<P> = P extends "pre" ? "Pre" : P extends "post" ? "Post" : "PostError";

/**
 * The events of a hook registration as written in the decorator call, for error texts.
 *
 * @example
 * ```ts
 * type A = EventsText<"document.save">; // "\"document.save\""
 * type B = EventsText<readonly ["document.save", "document.validate"]>; // "[\"document.save\", \"document.validate\"]"
 * ```
 */
type EventsText<E> = E extends string ? `"${E}"` : E extends readonly string[] ? `[${EventList<E>}]` : "…";

/**
 * A list of events joined by commas, each in quotes.
 *
 * @example
 * ```ts
 * type L = EventList<readonly ["a", "b"]>; // "\"a\", \"b\""
 * ```
 */
type EventList<E> = E extends readonly [infer F extends string]
  ? `"${F}"`
  : E extends readonly [infer F extends string, ...infer R]
    ? `"${F}", ${EventList<R>}`
    : "";

/**
 * The events of a hook registration (one or a list).
 *
 * @example
 * ```ts
 * type A = HookEventsOf<readonly ["document.save", "document.validate"]>; // "document.save" | "document.validate"
 * ```
 */
type HookEventsOf<E> = E extends readonly (infer U)[] ? U : E;

/**
 * The error of a declared `this` that does not fit the hook's events.
 *
 * @example
 * ```ts
 * const e: DeclaredThisError["typemoError"] = "the declared this does not match the hook event (document → HydratedDoc<Entity> | Subdocument<Entity>, the entity or its Subdocument; others → OperationHookContext)";
 * ```
 */
interface DeclaredThisError {
  /** The message shown at the decorator. */
  readonly typemoError: "the declared this does not match the hook event (document → HydratedDoc<Entity> | Subdocument<Entity>, the entity or its Subdocument; others → OperationHookContext)";
}
