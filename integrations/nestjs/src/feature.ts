/*
 * The entries of `TypemoModule.forFeature`: an entity class, an entity with the statics of its plugins, a view or a
 * materialized result. A view and a materialized result need a definition (the source and the pipeline), so they are
 * made with `TypemoModule.view(...)` and `TypemoModule.materialized(...)`: the definition is checked against the class
 * by the same types as `TypedView.define` and `Materialized.define`, and it is applied to the connection of the
 * feature when the provider is created.
 */
import {
  ConfigurationError,
  type Connection,
  type DocOf,
  type EntityClass,
  Materialized,
  type MaterializedRowCheck,
  type MaterializedWrite,
  type Model,
  type PipelineBuilder,
  type SchemaPlugin,
  type SourceInput,
  type StagedPipeline,
  TypedView,
  type TypedViewDefinition,
  type ViewRowCheck,
} from "@venloc/typemo";
import type { FeatureKind } from "./feature-registry.ts";

/**
 * An entity whose model is injected with the statics of its plugins: `model.statics(plugin)` for each one, so the
 * injected model has them in its type and the start fails when a plugin is not applied to the entity's schema.
 *
 * @typeParam E - The entity class.
 * @example
 * ```ts
 * const slugPlugin: SchemaPlugin<undefined, { bySlug(this: Model<object>, slug: string): string }> = {
 *   name: "slug",
 *   apply: () => {},
 *   statics: { bySlug(slug: string) { return slug; } },
 * };
 * @Plugin(slugPlugin)
 * @Schema({ collection: "posts" })
 * class Post extends Entity {}
 * const feature: ModelFeature<typeof Post> = { entity: Post, statics: slugPlugin };
 * ```
 */
export interface ModelFeature<E extends EntityClass = EntityClass> {
  /** The entity class. */
  readonly entity: E;
  /** The plugin (or plugins) whose statics the injected model exposes. */
  readonly statics?: SchemaPlugin<never, object> | readonly SchemaPlugin<never, object>[];
}

/**
 * A view for `forFeature`, made by `TypemoModule.view`. The injected value is the `TypedView` of the class.
 *
 * @typeParam V - The row type (the view class instance type).
 * @example
 * ```ts fragment
 * const feature: ViewFeature<OpenAccount> = TypemoModule.view(OpenAccount, { on: Account, pipeline: (p) => p.match({ closed: false }) });
 * ```
 */
export interface ViewFeature<V extends object> {
  /** Brand: made by `TypemoModule.view`. */
  readonly kind: "view";
  /** The view class. */
  readonly entity: EntityClass<V>;
  /**
   * Defines the view on a connection.
   *
   * @param connection - The connection of the feature.
   * @returns The typed view.
   */
  define(connection: Connection): TypedView<V>;
}

/**
 * A materialized result for `forFeature`, made by `TypemoModule.materialized`. The injected value is the
 * `Materialized` object (its `model` reads the target collection, `refresh()` computes it).
 *
 * @typeParam T - The target class instance type.
 * @example
 * ```ts fragment
 * const feature: MaterializedFeature<CustomerTotal> = TypemoModule.materialized(CustomerTotal, { from: Order, pipeline });
 * ```
 */
export interface MaterializedFeature<T extends object> {
  /** Brand: made by `TypemoModule.materialized`. */
  readonly kind: "materialized";
  /** The target class. */
  readonly entity: EntityClass<T>;
  /**
   * Defines the materialized result on a connection.
   *
   * @param connection - The connection of the feature.
   * @returns The materialized result.
   */
  define(connection: Connection): Materialized<T>;
}

/**
 * One entry of `TypemoModule.forFeature`.
 *
 * @example
 * ```ts
 * @Schema({ collection: "accounts" })
 * class Account extends Entity {}
 * const features: readonly TypemoFeature[] = [Account];
 * ```
 */
export type TypemoFeature = EntityClass | ModelFeature | ViewFeature<object> | MaterializedFeature<object>;

/**
 * A `forFeature` entry, checked and reduced to what the provider needs.
 *
 * @example
 * ```ts fragment
 * const entry: NormalizedFeature = Features.normalize(Account);
 * ```
 */
export interface NormalizedFeature {
  /** The class (its token is `getModelToken(entity, target)`). */
  readonly entity: EntityClass;
  /** What it is on the connection. */
  readonly kind: FeatureKind;
  /**
   * Makes the injected value.
   *
   * @param connection - The connection of the feature.
   * @returns The model, the view or the materialized result.
   */
  readonly create: (connection: Connection) => unknown;
}

/** Builds and checks the entries of `forFeature`. */
export class Features {
  /**
   * A view of `forFeature`: the class of a row, the source and the pipeline, checked as by `TypedView.define`.
   *
   * @typeParam View - The view class.
   * @typeParam Src - The source entity or view.
   * @typeParam R - The staged pipeline the callback returns.
   * @param view - The view class (`@Schema({ collection: "<view name>" })`).
   * @param definition - `on`, `pipeline` and an optional `collation`.
   * @returns The entry to list in `forFeature`.
   * @throws {ConfigurationError} When `view` is not a class or the definition is not an object.
   */
  static view<View extends abstract new () => object, const Src extends SourceInput, R extends StagedPipeline>(
    view: View,
    definition: TypedViewDefinition<Src, R> & {
      readonly pipeline: (
        p: PipelineBuilder<DocOf<Src>, "view", "empty">,
      ) => R & ViewRowCheck<R extends PipelineBuilder<infer Row, "view", "staged"> ? Row : never, InstanceType<View>>;
    },
  ): ViewFeature<InstanceType<View>> {
    Features.assertClass(view, "TypemoModule.view");
    Features.assertDefinition(definition, "TypemoModule.view");
    const entity = view as unknown as EntityClass<InstanceType<View>>;
    return Object.freeze({
      kind: "view" as const,
      entity,
      define: (connection: Connection) => TypedView.define(connection, view, definition),
    });
  }

  /**
   * A materialized result of `forFeature`: the target class, the source entity, the pipeline and the write mode,
   * checked as by `Materialized.define`.
   *
   * @typeParam Target - The target class.
   * @typeParam Src - The source entity class.
   * @typeParam R - The staged pipeline the callback returns.
   * @param target - The target class (an ordinary collection).
   * @param definition - `from`, `pipeline` and the write settings (`mode`, `on`, `whenMatched`, `whenNotMatched`).
   * @returns The entry to list in `forFeature`.
   * @throws {ConfigurationError} When `target` is not a class or the definition is not an object.
   */
  static materialized<
    Target extends abstract new () => object,
    const Src extends EntityClass,
    R extends StagedPipeline,
  >(
    target: Target,
    definition: {
      readonly from: Src;
      readonly pipeline: (
        p: PipelineBuilder<DocOf<Src>, "collection", "empty">,
      ) => R &
        MaterializedRowCheck<
          R extends PipelineBuilder<infer Row, "collection", "staged"> ? Row : never,
          InstanceType<Target>
        >;
    } & MaterializedWrite<InstanceType<Target>>,
  ): MaterializedFeature<InstanceType<Target>> {
    Features.assertClass(target, "TypemoModule.materialized");
    Features.assertDefinition(definition, "TypemoModule.materialized");
    const entity = target as unknown as EntityClass<InstanceType<Target>>;
    return Object.freeze({
      kind: "materialized" as const,
      entity,
      define: (connection: Connection) => Materialized.define(connection, target, definition),
    });
  }

  /**
   * Checks one `forFeature` entry and reduces it to what the provider needs.
   *
   * @param feature - The entry.
   * @returns The class, its kind and how to make the injected value.
   * @throws {ConfigurationError} When the entry is not a class, `{ entity, statics }` or a view or materialized
   *   result made by `TypemoModule`.
   */
  static normalize(feature: TypemoFeature): NormalizedFeature {
    if (typeof feature === "function") {
      return { entity: feature, kind: "model", create: (connection) => connection.model(feature) };
    }
    if (typeof feature !== "object" || feature === null) {
      throw new ConfigurationError(
        `TypemoModule.forFeature: an entry is an entity class, { entity, statics }, TypemoModule.view(...) or TypemoModule.materialized(...), got ${feature === null ? "null" : typeof feature}`,
      );
    }
    if ("kind" in feature) {
      const defined = feature as ViewFeature<object> | MaterializedFeature<object>;
      if (defined.kind !== "view" && defined.kind !== "materialized") {
        throw new ConfigurationError(
          `TypemoModule.forFeature: an entry with an unknown kind ${JSON.stringify((feature as { readonly kind: unknown }).kind)}`,
        );
      }
      return { entity: defined.entity, kind: defined.kind, create: (connection) => defined.define(connection) };
    }
    const { entity, statics } = feature as ModelFeature;
    Features.assertClass(entity, "TypemoModule.forFeature: { entity }");
    const extra = Object.keys(feature).filter((key) => key !== "entity" && key !== "statics");
    if (extra.length > 0) {
      throw new ConfigurationError(
        `TypemoModule.forFeature: unknown key${extra.length === 1 ? "" : "s"} ${extra.map((key) => `"${key}"`).join(", ")} in { entity: ${entity.name} } (known: entity, statics)`,
      );
    }
    const plugins = statics === undefined ? [] : Array.isArray(statics) ? statics : [statics];
    for (const plugin of plugins) {
      if (typeof plugin !== "object" || plugin === null || typeof plugin.name !== "string") {
        throw new ConfigurationError(
          `TypemoModule.forFeature: statics of ${entity.name} is a schema plugin or a list of them`,
        );
      }
    }
    return {
      entity,
      kind: "model",
      create: (connection) => {
        let model: Model<object> = connection.model(entity);
        for (const plugin of plugins) model = model.statics(plugin);
        return model;
      },
    };
  }

  /**
   * Checks that a value is a class.
   *
   * @param value - The value.
   * @param where - The caller, for the message.
   * @throws {ConfigurationError} When it is not a function.
   */
  static assertClass(value: unknown, where: string): void {
    if (typeof value !== "function") {
      throw new ConfigurationError(
        `${where}: an entity class (@Schema), got ${value === null ? "null" : typeof value}`,
      );
    }
  }

  /**
   * Checks that a definition is an object.
   *
   * @param value - The definition.
   * @param where - The caller, for the message.
   * @throws {ConfigurationError} When it is not an object.
   */
  static assertDefinition(value: unknown, where: string): void {
    if (typeof value !== "object" || value === null) {
      throw new ConfigurationError(`${where}: the definition is an object`);
    }
  }
}
