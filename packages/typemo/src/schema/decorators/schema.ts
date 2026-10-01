import { MetadataBuilder } from "../metadata/metadata-builder.ts";
import type { SchemaPlugin } from "../metadata/metadata-types.ts";
import type { SchemaOptions } from "../options/schema-options.ts";
import type { EntityClass } from "../options/type-spec.ts";
import type { DiscriminatorCheck, SchemaCheck } from "./class-checks.ts";

/**
 * Marks a class as a schema: an entity, a subdocument or, with `nested: true`, a nested object.
 * A class used as a field type or a model without `@Schema` is a build error. Field names in the
 * options (`timeseries.timeField`, `discriminatorKey`, policy fields) are checked against the class.
 * The class must be constructible without arguments (`C extends EntityClass`).
 *
 * @param options - Schema options; omitted means the defaults.
 * @returns A class decorator that records the schema options in the class metadata.
 * @example
 * ```ts
 * @Schema({ collection: "users" })
 * class User { ... }
 * ```
 */
export const Schema =
  <const O extends SchemaOptions = Record<never, never>>(options?: O) =>
  <C extends EntityClass>(target: C & SchemaCheck<C, O>): void => {
    MetadataBuilder.for(target).setSchema(options ?? {});
  };

/**
 * Declares the class a discriminator of its base class: `class Circle extends Shape` with
 * `@Discriminator("circle")`. The value is stored in the base's discriminator key and resolves the
 * class by value. Fields are the base's plus the class's own (semantic merge).
 *
 * The class must declare the key with the literal value, `declare readonly __t:
 * DiscriminatorValue<"circle">` (the base's `discriminatorKey` instead of `__t` when it has one), and
 * the value must be given as a literal; otherwise the decorator is a type error. The lean and plain
 * forms then carry the literal, and a union of discriminators narrows by the key. A nested
 * intermediate declares the union of its own and its sub-discriminators' values. At run time an
 * omitted value still defaults to the class name.
 *
 * @param value - The literal discriminator value; defaults to the class name at run time.
 * @returns A class decorator that records the discriminator value in the class metadata.
 * @example
 * ```ts
 * @Discriminator("circle")
 * @Schema()
 * class Circle extends Shape {
 *   declare readonly __t: DiscriminatorValue<"circle">;
 * }
 * ```
 */
export const Discriminator =
  <const V extends string = string>(value?: V) =>
  <C extends EntityClass>(target: C & DiscriminatorCheck<C, V>): void => {
    MetadataBuilder.for(target).setDiscriminator(value ?? target.name);
  };

/**
 * Applies a schema plugin to this class at compile time (model level). Global and connection
 * plugins are registered with `Typemo.plugin()` and the compile context. Options are typed by the plugin.
 *
 * @param plugin - The plugin to apply.
 * @param options - The plugin options; required when the plugin's options type does not accept `undefined`.
 * @returns A class decorator that records the plugin in the class metadata.
 * @example
 * ```ts
 * @Plugin(timestampsPlugin, { updatedAt: true })
 * @Schema()
 * class User { ... }
 * ```
 */
export const Plugin =
  <O>(plugin: SchemaPlugin<O>, ...options: undefined extends O ? [options?: O] : [options: O]) =>
  <C extends EntityClass>(target: C): void => {
    MetadataBuilder.for(target).addPlugin(plugin, options[0] as O);
  };
