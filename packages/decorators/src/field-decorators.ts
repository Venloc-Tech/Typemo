import type {
  NoExtraOptions,
  PropCheck,
  PropOptions,
  TenantCheck,
  TypeSpec,
  VirtualCheck,
  VirtualOptions,
} from "@venloc/typemo/adapters";
import { Tc39Metadata } from "./tc39-metadata.ts";

/**
 * The literal facts TypeScript gives a field decorator context: its name and whether it is private/static.
 *
 * @example
 * ```ts
 * type Facts = FieldFacts<"name", false, false>; // { name: "name"; private: false; static: false }
 * ```
 */
interface FieldFacts<K extends string, P extends boolean, St extends boolean> {
  /** The field name as a literal type. */
  readonly name: K;
  /** Whether the field is a `#private` one. */
  readonly private: P;
  /** Whether the field is `static`. */
  readonly static: St;
}

/**
 * The TC39 adapter of `PropCheck`: `unknown` when the options fit the field type `V`, otherwise an
 * object carrier the context cannot satisfy (the message is shown at the decorator). Unlike the legacy
 * adapter, the field type comes from `ClassFieldDecoratorContext<This, V>` itself, and `#private` and
 * `static` are known at compile time from the context's literal `private`/`static`.
 *
 * @example
 * ```ts
 * // A static field resolves to { typemoError: '@Prop "x": static fields are not schema fields' },
 * // so the decorator fails to type-check on it.
 * ```
 */
export type Tc39PropCheck<This, K extends string, V, S, O, P extends boolean, St extends boolean> = St extends true
  ? { readonly typemoError: `@Prop "${K}": static fields are not schema fields` }
  : P extends true
    ? { readonly typemoError: `@Prop "${K}": #private fields cannot be schema fields` }
    : K extends keyof This
      ? PropCheck<K, V, S, O> extends infer R
        ? R extends true
          ? unknown
          : { readonly typemoError: R }
        : never
      : /* TS `private`/`protected` members are not in `keyof This` (the context says `private: false` for them). */
        {
          readonly typemoError: `@Prop "${K}": not a public field (private and protected fields cannot be schema fields)`;
        };

/**
 * The decorator `@Prop(...)` returns (TC39 field decorator).
 *
 * @example
 * ```ts
 * const requiredName: Tc39PropDecorator<StringConstructor, { required: true }> = Prop(() => String, { required: true });
 * @Schema({ collection: "users" })
 * class User extends Entity {
 *   @requiredName name!: string;
 * }
 * ```
 */
export type Tc39PropDecorator<S, O> = <This, V, K extends string, P extends boolean, St extends boolean>(
  value: undefined,
  context: ClassFieldDecoratorContext<This, V> & FieldFacts<K, P, St> & Tc39PropCheck<This, K, V, S, O, P, St>,
) => void;

/**
 * A schema field, TC39 form of the core `@Prop` with the same options. The runtime type thunk is
 * required: TC39 decorators have no `design:type` metadata.
 *
 * @param type - Thunk returning the runtime type, for example `() => String`.
 * @param options - Field options, checked against the type.
 * @returns A TC39 field decorator.
 * @throws {ConfigurationError} When applied to a static, private, symbol-keyed or non-field member, when the
 * type is not a thunk, or when mixed with legacy decorators.
 *
 * @example
 * ```ts
 * @Prop(() => String, { required: true, trim: true }) name!: string;
 * ```
 */
export const Prop = <const S extends TypeSpec, const O extends PropOptions<S>>(
  type: () => S,
  options?: O & NoExtraOptions<O, PropOptions<S>>,
): Tc39PropDecorator<S, O> => {
  const decorate = (_value: undefined, context: unknown): void => {
    const ctx = Tc39Metadata.context("@Prop", context);
    Tc39Metadata.assertThunk("@Prop", ctx, type);
    Tc39Metadata.record("@Prop", ctx, {
      kind: "field",
      key: Tc39Metadata.fieldName("@Prop", ctx),
      type,
      options: (options ?? {}) as PropOptions<never>,
    });
  };
  /* The typed signature (This, V, K inferred from the context) is a view of the same function. */
  return decorate as Tc39PropDecorator<S, O>;
};

/**
 * The decorator `@Virtual(...)` returns (TC39 field decorator).
 *
 * @example
 * ```ts
 * const decorator: Tc39VirtualDecorator<VirtualOptions> = Virtual({ ref: () => Post, localField: "_id", foreignField: "author" });
 * ```
 */
export type Tc39VirtualDecorator<O> = <This, V, K extends string, P extends boolean, St extends boolean>(
  value: undefined,
  context: ClassFieldDecoratorContext<This, V> & FieldFacts<K, P, St> & VirtualCheck<This, K, O>,
) => void;

/**
 * A populate virtual on a `VirtualRef<Model, JustOne, Count>` field, TC39 form of the core `@Virtual`.
 *
 * @param options - Populate virtual options.
 * @returns A TC39 field decorator.
 * @throws {ConfigurationError} When applied to a non-field, static, private or symbol-keyed member.
 */
export const Virtual = <const O extends VirtualOptions>(options: O): Tc39VirtualDecorator<O> => {
  const decorate = (_value: undefined, context: unknown): void => {
    const ctx = Tc39Metadata.context("@Virtual", context);
    Tc39Metadata.record("@Virtual", ctx, { kind: "virtual", key: Tc39Metadata.fieldName("@Virtual", ctx), options });
  };
  return decorate as Tc39VirtualDecorator<O>;
};

/**
 * The decorator `@Tenant()` returns (TC39 field decorator).
 *
 * @example
 * ```ts
 * const decorator: Tc39TenantDecorator = Tenant();
 * ```
 */
export type Tc39TenantDecorator = <This, V, K extends string, P extends boolean, St extends boolean>(
  value: undefined,
  context: ClassFieldDecoratorContext<This, V> & FieldFacts<K, P, St> & TenantCheck<This, K>,
) => void;

/**
 * Marks the tenant field of a tenant-scoped schema, TC39 form of the core `@Tenant()`: next to `@Prop(...)` on a
 * field declared `TenantField<T>`. The schema build refuses a `tenant` option whose field is not marked, and a mark
 * without the option.
 *
 * @returns A TC39 field decorator.
 * @throws {ConfigurationError} When applied to a non-field, static, private or symbol-keyed member, or when mixed
 * with legacy decorators.
 *
 * @example
 * ```ts
 * @Schema({ collection: "notes", tenant: true })
 * class Note extends Entity {
 *   @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
 * }
 * ```
 */
export const Tenant = (): Tc39TenantDecorator => {
  const decorate = (_value: undefined, context: unknown): void => {
    const ctx = Tc39Metadata.context("@Tenant", context);
    Tc39Metadata.record("@Tenant", ctx, { kind: "tenant", key: Tc39Metadata.fieldName("@Tenant", ctx) });
  };
  return decorate as Tc39TenantDecorator;
};
