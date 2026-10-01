import { ConfigurationError } from "../../errors/configuration-error.ts";
import { MetadataBuilder } from "../metadata/metadata-builder.ts";
import type { ClassRef } from "../metadata/metadata-types.ts";
import type { NoExtraOptions, PropOptions } from "../options/prop-options.ts";
import type { TypeSpec } from "../options/type-spec.ts";
import { DecoratorGuard } from "./decorator-guard.ts";
import type { PropCheck } from "./prop-check.ts";

/**
 * The legacy adapter of {@link PropCheck}: `unknown` when the options fit `T[K]`, otherwise
 * `{ K: { typemoError: message } }`, which `T[K]` cannot satisfy. An object carrier, because a
 * string-literal message would reduce `T & { K: message }` to `never` for a literal-typed field.
 * A key that is not in `keyof T` is a `private`/`protected` field: the legacy decorator cannot see
 * its type, so it is refused.
 *
 * @example
 * ```ts
 * type Ok = LegacyPropCheck<User, "name", typeof String, { required: true }>; // unknown
 * ```
 */
export type LegacyPropCheck<T, K extends string, S, O> = T extends ClassRef
  ? { readonly [P in K]: { readonly typemoError: `@Prop "${K}": static fields are not schema fields` } }
  : K extends keyof T
    ? PropCheck<K, T[K], S, O> extends infer R
      ? R extends true
        ? unknown
        : { readonly [P in K]: { readonly typemoError: R } }
      : never
    : {
        readonly [P in K]: {
          readonly typemoError: `@Prop "${K}": not a public field (private and protected fields cannot be schema fields)`;
        };
      };

/**
 * The decorator `@Prop(...)` returns: checks the options against the declared field type.
 *
 * @example
 * ```ts
 * const decorator: PropDecorator<StringConstructor, { required: true }> = Prop(() => String, { required: true });
 * ```
 */
export type PropDecorator<S, O> = <T extends object, K extends string>(
  target: T & LegacyPropCheck<T, K, S, O>,
  key: K,
) => void;

/**
 * A schema field. The runtime type is required on every field and is a thunk, so a class declared
 * later in the file or in a module cycle is resolved at compile time. The options are checked
 * against the declared type of the field (rules in `PropCheck`), and an option the type does not
 * accept is an error at its key. At run time the decorator only records; the compiler validates the
 * whole schema.
 *
 * @param type - A thunk returning the runtime type: a constructor, a class or an array of them.
 * @param options - Field options; checked against the declared field type.
 * @returns A property decorator that records the field in the class metadata.
 * @throws {ConfigurationError} From the returned decorator, when applied to a static member, a method
 * or an accessor, or when mixed with TC39 decorators.
 * @example
 * ```ts
 * @Prop(() => String, { required: true, trim: true }) name!: string;
 * @Prop(() => [Address]) addresses!: Address[];
 * @Prop(() => Types.ObjectId, { ref: () => User }) author!: Ref<User>;
 * ```
 */
export const Prop = <const S extends TypeSpec, const O extends PropOptions<S>>(
  type: () => S,
  options?: O & NoExtraOptions<O, PropOptions<S>>,
): PropDecorator<S, O> => {
  const decorate = (target: object, key: string | symbol, descriptor?: unknown): void => {
    DecoratorGuard.assertLegacy("@Prop", key);
    if (typeof target === "function") {
      throw new ConfigurationError(
        `${target.name}: @Prop on static member "${String(key)}" (static fields are not schema fields)`,
      );
    }
    const owner = (target as { constructor: ClassRef }).constructor;
    if (descriptor !== undefined) {
      throw new ConfigurationError(
        `${owner.name}: @Prop on "${String(key)}", which is a method or an accessor (getters are virtuals and need no decorator)`,
      );
    }
    MetadataBuilder.for(owner).addField(key as string, type, (options ?? {}) as Readonly<Record<string, unknown>>);
  };
  /* The typed signature (T, K inferred from the call site) is a view of the same function. */
  return decorate as PropDecorator<S, O>;
};
