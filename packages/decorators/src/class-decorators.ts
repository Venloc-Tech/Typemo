import { ConfigurationError } from "@venloc/typemo";
import type {
  DiscriminatorCheck,
  EntityClass,
  IndexCheck,
  IndexFields,
  IndexOptions,
  SchemaCheck,
  SchemaOptions,
  SchemaPlugin,
  SearchIndexOptions,
} from "@venloc/typemo/adapters";
import { MetadataBuilder } from "@venloc/typemo/adapters";
import { Tc39Metadata } from "./tc39-metadata.ts";

/**
 * Every class decorator first replays the member entries of its class (fields before class-level
 * records, the order the legacy path produces), then writes its own record through the same builder.
 *
 * @param decorator - Decorator name used in error messages.
 * @param target - The decorated class.
 * @param context - The raw decorator context.
 * @returns The core metadata builder of the class.
 * @throws {ConfigurationError} When the decorator is not applied to a class.
 */
const builderFor = (decorator: string, target: EntityClass, context: unknown): MetadataBuilder => {
  const ctx = Tc39Metadata.context(decorator, context);
  if (ctx.kind !== "class") throw new ConfigurationError(`${decorator} is a class decorator, got ${ctx.kind}`);
  Tc39Metadata.flush(target, ctx.metadata);
  return MetadataBuilder.for(target, "tc39");
};

/**
 * Marks a class as a schema, TC39 form of the core `@Schema` with the same options and checks.
 *
 * @param options - Schema options; the literal type is kept for the compile-time checks.
 * @returns A TC39 class decorator.
 * @throws {ConfigurationError} When applied to something other than a class or mixed with legacy decorators.
 */
export const Schema =
  <const O extends SchemaOptions = Record<never, never>>(options?: O) =>
  <C extends EntityClass>(target: C & SchemaCheck<C, O>, context: ClassDecoratorContext<C>): void => {
    builderFor("@Schema", target, context).setSchema(options ?? {});
  };

/**
 * Declares the class a discriminator of its base class (same contract as the core `@Discriminator`).
 *
 * @param value - The discriminator value; defaults to the class name.
 * @returns A TC39 class decorator.
 * @throws {ConfigurationError} When applied to something other than a class or mixed with legacy decorators.
 */
export const Discriminator =
  <const V extends string = string>(value?: V) =>
  <C extends EntityClass>(target: C & DiscriminatorCheck<C, V>, context: ClassDecoratorContext<C>): void => {
    builderFor("@Discriminator", target, context).setDiscriminator(value ?? target.name);
  };

/**
 * Applies a schema plugin to this class when the schema is compiled (model level).
 *
 * @param plugin - The schema plugin.
 * @param options - Plugin options; required when the plugin's option type does not accept `undefined`.
 * @returns A TC39 class decorator.
 * @throws {ConfigurationError} When applied to something other than a class or mixed with legacy decorators.
 */
export const Plugin =
  <O>(plugin: SchemaPlugin<O>, ...options: undefined extends O ? [options?: O] : [options: O]) =>
  <C extends EntityClass>(target: C, context: ClassDecoratorContext<C>): void => {
    builderFor("@Plugin", target, context).addPlugin(plugin, options[0] as O);
  };

/**
 * A compound (or any) index on the class, checked against the class like the core `@Index`.
 *
 * @param fields - Indexed fields with their directions.
 * @param options - Index options.
 * @returns A TC39 class decorator.
 * @throws {ConfigurationError} When applied to something other than a class or mixed with legacy decorators.
 */
export const Index =
  <const F extends IndexFields, const O extends IndexOptions = Record<never, never>>(fields: F, options?: O) =>
  <C extends EntityClass>(target: C & IndexCheck<C, F, O>, context: ClassDecoratorContext<C>): void => {
    builderFor("@Index", target, context).addIndex(fields, options ?? {});
  };

/**
 * An Atlas Search / Vector Search index description.
 *
 * @param options - The search index definition.
 * @returns A TC39 class decorator.
 * @throws {ConfigurationError} When applied to something other than a class or mixed with legacy decorators.
 */
export const SearchIndex =
  (options: SearchIndexOptions) =>
  <C extends EntityClass>(target: C, context: ClassDecoratorContext<C>): void => {
    builderFor("@SearchIndex", target, context).addSearchIndex(options);
  };
