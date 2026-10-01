import type { HookEvent, HookPhase } from "../../hooks/hook-events.ts";
import type { IndexFields, IndexOptions, SearchIndexOptions } from "../options/index-options.ts";
import type {
  AuditSchemaOptions,
  SchemaOptions,
  SoftDeleteSchemaOptions,
  TenantSchemaOptions,
} from "../options/schema-options.ts";
import type { VirtualOptions } from "../options/virtual-options.ts";

/*
 * The raw metadata records written by the decorators (both packages) and by plugins through
 * `MetadataBuilder`. Records are frozen; every write replaces the class record (copy on write), so a
 * record read once never changes under the reader.
 */

/**
 * Any class (the owner of metadata). Constructor parameters are irrelevant for storage.
 *
 * @example
 * ```ts
 * const owner: ClassRef = User;
 * ```
 */
export type ClassRef = abstract new (...args: never) => object;

/**
 * Service fields filled by the core, not by constructors.
 *
 * @example
 * ```ts
 * const service: ServiceField = "createdAt";
 * ```
 */
export type ServiceField = "id" | "createdAt" | "updatedAt" | "version" | "discriminatorKey";

/**
 * One `@Prop` (or a field added by a plugin).
 *
 * @example
 * ```ts
 * const record: FieldRecord = { key: "name", type: () => String, options: { required: true }, owner: User };
 * ```
 */
export interface FieldRecord {
  /** Property name. */
  readonly key: string;
  /** The type thunk (`() => TypeSpec`). Called at compile time only (declaration order, TDZ). */
  readonly type: () => unknown;
  /** Options as given (frozen shallow copy). The compiler validates and normalizes them. */
  readonly options: Readonly<Record<string, unknown>>;
  /** The class that declared the field. */
  readonly owner: ClassRef;
  /** The service role of the field, when the core fills it. */
  readonly service?: ServiceField;
}

/**
 * One `@Index`.
 *
 * @example
 * ```ts
 * const record: IndexRecord = { fields: { email: 1 }, options: { unique: true }, owner: User };
 * ```
 */
export interface IndexRecord {
  /** The indexed fields. */
  readonly fields: IndexFields;
  /** The index options. */
  readonly options: IndexOptions;
  /** The class that declared the index. */
  readonly owner: ClassRef;
}

/**
 * One `@SearchIndex`.
 *
 * @example
 * ```ts
 * const record: SearchIndexRecord = { options: { name: "default", definition: {} }, owner: User };
 * ```
 */
export interface SearchIndexRecord {
  /** The search index options. */
  readonly options: SearchIndexOptions;
  /** The class that declared the index. */
  readonly owner: ClassRef;
}

/**
 * One `@Virtual` (populate virtual).
 *
 * @example
 * ```ts
 * const options = { ref: () => Post, localField: "_id", foreignField: "author" };
 * const record: VirtualRecord = { key: "posts", options, owner: User };
 * ```
 */
export interface VirtualRecord {
  /** The virtual's property name. */
  readonly key: string;
  /** The virtual options. */
  readonly options: VirtualOptions;
  /** The class that declared the virtual. */
  readonly owner: ClassRef;
}

/**
 * A hook function as stored. `this` and the arguments are checked by the decorators per event; the
 * store keeps one erased shape (`this: unknown`, arguments `never[]`) — no `any`.
 *
 * @example
 * ```ts
 * const fn: HookFunction = function (this: unknown) { return undefined; };
 * ```
 */
export type HookFunction = (this: unknown, ...args: never[]) => unknown;

/**
 * One `@Pre` / `@Post` / `@PostError` (or a hook added by a plugin).
 *
 * @example
 * ```ts
 * const record: HookRecord = { phase: "pre", events: ["document.save"], fn, key: "audit", owner: User };
 * ```
 */
export interface HookRecord {
  /** When the hook runs relative to the operation. */
  readonly phase: HookPhase;
  /** The events the hook listens to. */
  readonly events: readonly HookEvent[];
  /** The hook function. */
  readonly fn: HookFunction;
  /** Method name for decorator hooks, `undefined` for plugin hooks. */
  readonly key: string | undefined;
  /** The class that declared the hook. */
  readonly owner: ClassRef;
  /** Name of the plugin that added it (for messages and ordering). */
  readonly plugin?: string;
}

/**
 * A static a plugin adds to the models of its schemas: `this` is the model (erased here, typed by `statics`).
 *
 * @example
 * ```ts
 * const fn: StaticFunction = function (this: Model<object>) { return this.modelName; };
 * ```
 */
export type StaticFunction = (this: never, ...args: never[]) => unknown;

/**
 * A schema plugin: applied at compile time through a `MetadataBuilder`. `S` types the statics it adds (its
 * `statics` object): `model.statics(plugin)` gives the model with them.
 *
 * @example
 * ```ts
 * const plugin: SchemaPlugin = { name: "slug", apply: (builder) => builder.addIndex({ slug: 1 }) };
 * ```
 */
export interface SchemaPlugin<O = undefined, S extends object = Record<never, never>> {
  /** Unique name: used in messages and to detect conflicting registrations. */
  readonly name: string;
  /**
   * Applies the plugin to a schema being compiled. Method syntax on purpose: parameter bivariance lets
   * plugins with different options share one list.
   *
   * @param builder - What the plugin may add to the schema.
   * @param options - The options the plugin was registered with.
   */
  apply(builder: PluginBuilder, options: O): void;
  /**
   * Statics for every model of a schema the plugin is applied to (`this` = the model; declare it:
   * `function (this: Model<object>, …)`). Typed on a model with `model.statics(plugin)`.
   */
  readonly statics?: S;
}

/**
 * The statics a plugin adds (its `statics` object's type), as the model exposes them: BOUND to the model at
 * runtime, so their `this` parameter is dropped (a `this: Model<object>` would not accept a `Model<User>`,
 * and a generic `this: Model<T>` makes the checker infer T over the whole model: TS2589).
 *
 * @example
 * ```ts
 * type Bound = PluginStatics<{ statics: { count(this: Model<object>): number } }>; // { count(): number }
 * ```
 */
export type PluginStatics<P> = P extends { readonly statics?: infer S }
  ? { readonly [K in keyof Exclude<S, undefined>]: OmitThisParameter<Exclude<S, undefined>[K]> }
  : never;

/**
 * The application policies a plugin may enable: the same options as `@Schema`.
 *
 * @example
 * ```ts
 * const policies: PluginPolicies = { softDelete: true };
 * ```
 */
export interface PluginPolicies {
  /** Tenant isolation. */
  readonly tenant?: true | TenantSchemaOptions;
  /** Soft delete. */
  readonly softDelete?: true | SoftDeleteSchemaOptions;
  /** Audit trail. */
  readonly audit?: true | AuditSchemaOptions;
}

/**
 * What a plugin may do: add fields, indexes, virtuals and hooks to the schema being compiled.
 *
 * @example
 * ```ts
 * const apply = (builder: PluginBuilder): void => builder.addField("slug", () => String);
 * ```
 */
export interface PluginBuilder {
  /** The class being compiled. */
  readonly target: ClassRef;
  /** Keys of the fields the schema already has (before this plugin). */
  readonly fieldKeys: readonly string[];
  /**
   * Adds a field.
   *
   * @param key - The property name.
   * @param type - The type thunk.
   * @param options - Field options.
   */
  addField(key: string, type: () => unknown, options?: Readonly<Record<string, unknown>>): void;
  /**
   * Adds an index.
   *
   * @param fields - The indexed fields.
   * @param options - Index options.
   */
  addIndex(fields: IndexFields, options?: IndexOptions): void;
  /**
   * Adds a hook.
   *
   * @param phase - When the hook runs.
   * @param events - The event or events it listens to.
   * @param fn - The hook function.
   */
  addHook(phase: HookPhase, events: HookEvent | readonly HookEvent[], fn: HookFunction): void;
  /**
   * Adds a populate virtual.
   *
   * @param key - The virtual's property name.
   * @param options - The virtual options.
   */
  addVirtual(key: string, options: VirtualOptions): void;
  /**
   * Adds a static to the models of this schema (`this` = the model). Plugins only.
   *
   * @param name - The static's name.
   * @param fn - The function.
   */
  addStatic(name: string, fn: StaticFunction): void;
  /**
   * Enables an application policy (tenant, soft delete, audit) as `@Schema` would. Plugins only.
   *
   * @param policy - The policy to enable.
   * @param options - The policy's options.
   */
  enablePolicy<K extends keyof PluginPolicies>(policy: K, options: NonNullable<PluginPolicies[K]>): void;
}

/**
 * What plugins add beyond the class record (statics, policies), collected while they run.
 *
 * @example
 * ```ts
 * const draft: PluginDraft = { record, statics: new Map(), policies: {} };
 * ```
 */
export interface PluginDraft {
  /** The class record being extended. */
  record: ClassRecord;
  /** The statics plugins added, by name. */
  readonly statics: Map<string, { readonly fn: StaticFunction; readonly plugin: string }>;
  /** The policies plugins enabled. */
  readonly policies: Partial<Record<keyof PluginPolicies, { readonly value: unknown; readonly plugin: string }>>;
}

/**
 * One `@Plugin` on a class.
 *
 * @example
 * ```ts
 * const record: PluginRecord = { plugin: slugPlugin, options: undefined, owner: User };
 * ```
 */
export interface PluginRecord {
  /** The plugin. */
  readonly plugin: SchemaPlugin<unknown>;
  /** The options the plugin was registered with. */
  readonly options: unknown;
  /** The class the plugin is applied to. */
  readonly owner: ClassRef;
}

/**
 * Everything the decorators recorded on ONE class (not merged with its parents).
 *
 * @example
 * ```ts
 * const record: ClassRecord = MetadataStore.own(User);
 * ```
 */
export interface ClassRecord {
  /** `@Schema` options, `undefined` when the class has no `@Schema`. */
  readonly schema: SchemaOptions | undefined;
  /** The `@Prop` fields. */
  readonly fields: readonly FieldRecord[];
  /** The `@Index` records. */
  readonly indexes: readonly IndexRecord[];
  /** The `@SearchIndex` records. */
  readonly searchIndexes: readonly SearchIndexRecord[];
  /** The `@Virtual` records. */
  readonly virtuals: readonly VirtualRecord[];
  /** The hook records. */
  readonly hooks: readonly HookRecord[];
  /** The `@Plugin` records. */
  readonly plugins: readonly PluginRecord[];
  /** `@Discriminator(value)` on this class. */
  readonly discriminator: { readonly value: string } | undefined;
  /** The fields marked `@Tenant()` on this class. */
  readonly tenantFields: readonly string[];
}
