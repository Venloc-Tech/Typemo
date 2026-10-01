import { ConfigurationError } from "../../errors/configuration-error.ts";
import { HOOK_EVENTS, type HookEvent, type HookPhase } from "../../hooks/hook-events.ts";
import type { IndexFields, IndexOptions, SearchIndexOptions } from "../options/index-options.ts";
import type { SchemaOptions } from "../options/schema-options.ts";
import type { VirtualOptions } from "../options/virtual-options.ts";
import { type MetadataOrigin, MetadataStore } from "./metadata-store.ts";
import type {
  ClassRecord,
  ClassRef,
  HookFunction,
  PluginBuilder,
  PluginDraft,
  PluginPolicies,
  SchemaPlugin,
  ServiceField,
  StaticFunction,
} from "./metadata-types.ts";

/** Names a field may never have: they would shadow the prototype machinery. */
const FORBIDDEN_NAMES: ReadonlySet<string> = new Set(["constructor", "prototype", "__proto__"]);

/** The names of the events a hook may listen to. */
const KNOWN_EVENTS: ReadonlySet<string> = new Set(HOOK_EVENTS);

/**
 * The one API that writes schema metadata. The legacy decorators of the core call it, the TC39 package calls
 * it with the class from its class decorator, and plugins receive an instance bound to the schema being
 * compiled. Two decorator packages are thin adapters over this.
 *
 * Every method validates what it can see without the rest of the class (names, event names, value
 * shapes) and throws `ConfigurationError` at the declaration; checks that need the whole schema run
 * in the compiler. Inputs are copied and frozen, never kept by reference.
 */
export class MetadataBuilder implements PluginBuilder {
  /**
   * @param target - The class being described.
   * @param read - Reads the current class record.
   * @param write - Replaces the class record with an update of the current one.
   * @param pluginName - The plugin the builder is bound to, `undefined` for decorators.
   * @param extras - The draft a plugin's statics and policies are collected in.
   */
  private constructor(
    readonly target: ClassRef,
    private readonly read: () => ClassRecord,
    private readonly write: (update: (current: ClassRecord) => ClassRecord) => void,
    private readonly pluginName: string | undefined,
    private readonly extras: PluginDraft | undefined = undefined,
  ) {}

  /**
   * A builder writing to the metadata store of `target` (decorators).
   *
   * @param target - The class.
   * @param origin - The decorator package that writes.
   * @returns The builder.
   * @throws {ConfigurationError} When `target` is not a class.
   */
  static for(target: ClassRef, origin: MetadataOrigin = "legacy"): MetadataBuilder {
    if (typeof target !== "function") {
      throw new ConfigurationError(`MetadataBuilder: expected a class, got ${typeof target}`);
    }
    MetadataStore.markOrigin(target, origin);
    return new MetadataBuilder(
      target,
      () => MetadataStore.own(target),
      (update) => MetadataStore.write(target, update),
      undefined,
    );
  }

  /**
   * A builder writing into a draft record (plugins at compile time): the class metadata is never
   * touched, so the same class compiled with other plugins (another connection) stays independent.
   *
   * @param target - The class being compiled.
   * @param draft - The draft the plugin writes into.
   * @param pluginName - The plugin's name.
   * @returns The builder.
   */
  static draft(target: ClassRef, draft: PluginDraft, pluginName: string): MetadataBuilder {
    return new MetadataBuilder(
      target,
      () => draft.record,
      (update) => {
        draft.record = Object.freeze(update(draft.record));
      },
      pluginName,
      draft,
    );
  }

  /**
   * Adds a static to the models of this schema (plugins only; a name once per schema).
   *
   * @param name - The static's name.
   * @param fn - The function.
   * @throws {ConfigurationError} When not called by a plugin, the name is invalid or taken, or `fn` is not a
   * function.
   */
  addStatic(name: string, fn: StaticFunction): void {
    const extras = this.extras;
    if (extras === undefined || this.pluginName === undefined) this.fail("statics are added by plugins");
    if (typeof name !== "string" || name === "" || FORBIDDEN_NAMES.has(name))
      this.fail(`static "${String(name)}": invalid name`);
    if (typeof fn !== "function") this.fail(`static "${name}" must be a function`);
    const existing = extras.statics.get(name);
    if (existing !== undefined) this.fail(`static "${name}" is already added by plugin "${existing.plugin}"`);
    extras.statics.set(name, Object.freeze({ fn, plugin: this.pluginName }));
  }

  /**
   * Enables an application policy as `@Schema` would (plugins only).
   *
   * @param policy - The policy to enable.
   * @param options - `true` or the policy's options.
   * @throws {ConfigurationError} When not called by a plugin, the policy is unknown, the options are invalid, or
   * another plugin enabled the policy with other options.
   */
  enablePolicy<K extends keyof PluginPolicies>(policy: K, options: NonNullable<PluginPolicies[K]>): void {
    const extras = this.extras;
    if (extras === undefined || this.pluginName === undefined) this.fail("enablePolicy is for plugins; use @Schema");
    if (policy !== "tenant" && policy !== "softDelete" && policy !== "audit")
      this.fail(`unknown policy "${String(policy)}"`);
    if (options !== true && (typeof options !== "object" || options === null))
      this.fail(`policy "${policy}": true or an options object`);
    const existing = extras.policies[policy];
    if (existing !== undefined && JSON.stringify(existing.value) !== JSON.stringify(options)) {
      this.fail(`policy "${policy}" is enabled with other options by plugin "${existing.plugin}"`);
    }
    extras.policies[policy] = Object.freeze({
      value: options === true ? true : Object.freeze({ ...(options as object) }),
      plugin: this.pluginName,
    });
  }

  /** Keys of the fields the schema already has. */
  get fieldKeys(): readonly string[] {
    return this.read().fields.map((field) => field.key);
  }

  /**
   * Adds a field.
   *
   * @param key - The property name.
   * @param type - The type thunk.
   * @param options - Field options.
   * @throws {ConfigurationError} When the name is invalid or taken, or the type is not a thunk.
   */
  addField(key: string, type: () => unknown, options: Readonly<Record<string, unknown>> = {}): void {
    this.addFieldRecord(key, type, options, undefined);
  }

  /**
   * Adds a service field: declared by a base class, filled by the core.
   *
   * @param key - The property name.
   * @param type - The type thunk.
   * @param options - Field options.
   * @param service - The service role.
   * @throws {ConfigurationError} When the name is invalid or taken, or the type is not a thunk.
   */
  addServiceField(
    key: string,
    type: () => unknown,
    options: Readonly<Record<string, unknown>>,
    service: ServiceField,
  ): void {
    this.addFieldRecord(key, type, options, service);
  }

  /**
   * Marks a field as the tenant field (`@Tenant()`). The compiler checks it against the `tenant` policy.
   *
   * @param key - The property name.
   * @throws {ConfigurationError} When called by a plugin, the name is invalid, or the field is marked twice.
   */
  markTenantField(key: string): void {
    if (this.pluginName !== undefined) this.fail("the tenant field is marked by @Tenant() on the class");
    if (typeof key !== "string" || key === "" || FORBIDDEN_NAMES.has(key)) {
      this.fail(`@Tenant on "${String(key)}": invalid field name`);
    }
    if (this.read().tenantFields.includes(key)) this.fail(`@Tenant is applied twice on "${key}"`);
    this.write((current) => ({ ...current, tenantFields: Object.freeze([...current.tenantFields, key]) }));
  }

  /**
   * Records the `@Schema` options.
   *
   * @param options - The schema options.
   * @throws {ConfigurationError} When called by a plugin or applied twice.
   */
  setSchema(options: SchemaOptions): void {
    if (this.pluginName !== undefined) this.fail("a plugin cannot change schema options");
    if (this.read().schema !== undefined) this.fail("@Schema is applied twice");
    const copy = Object.freeze({ ...options });
    this.write((current) => ({ ...current, schema: copy }));
  }

  /**
   * Adds an index.
   *
   * @param fields - The indexed fields.
   * @param options - Index options.
   * @throws {ConfigurationError} When there is no field.
   */
  addIndex(fields: IndexFields, options: IndexOptions = {}): void {
    if (typeof fields !== "object" || fields === null || Object.keys(fields).length === 0) {
      this.fail("@Index needs at least one field");
    }
    const record = Object.freeze({
      fields: Object.freeze({ ...fields }),
      options: Object.freeze({ ...options }),
      owner: this.target,
    });
    this.write((current) => ({ ...current, indexes: Object.freeze([...current.indexes, record]) }));
  }

  /**
   * Adds an Atlas search index.
   *
   * @param options - Search index options.
   * @throws {ConfigurationError} When the index has no name.
   */
  addSearchIndex(options: SearchIndexOptions): void {
    if (typeof options?.name !== "string" || options.name === "") this.fail("@SearchIndex needs a name");
    const record = Object.freeze({ options: Object.freeze({ ...options }), owner: this.target });
    this.write((current) => ({ ...current, searchIndexes: Object.freeze([...current.searchIndexes, record]) }));
  }

  /**
   * Adds a populate virtual.
   *
   * @param key - The virtual's property name.
   * @param options - The virtual options.
   * @throws {ConfigurationError} When the name is invalid or taken, or `ref` is not a thunk.
   */
  addVirtual(key: string, options: VirtualOptions): void {
    this.checkName(key, "@Virtual");
    if (typeof options?.ref !== "function") this.fail(`@Virtual "${key}": "ref" must be a thunk () => Model`);
    if (this.read().virtuals.some((virtual) => virtual.key === key)) this.fail(`@Virtual "${key}" is declared twice`);
    const record = Object.freeze({ key, options: Object.freeze({ ...options }), owner: this.target });
    this.write((current) => ({ ...current, virtuals: Object.freeze([...current.virtuals, record]) }));
  }

  /**
   * Adds a hook.
   *
   * @param phase - When the hook runs.
   * @param events - The event or events it listens to.
   * @param fn - The hook function.
   * @param key - The method name for decorator hooks.
   * @throws {ConfigurationError} When there is no event, an event is unknown, or `fn` is not a function.
   */
  addHook(phase: HookPhase, events: HookEvent | readonly HookEvent[], fn: HookFunction, key?: string): void {
    const list: readonly unknown[] = typeof events === "string" ? [events] : events;
    if (!Array.isArray(list) || list.length === 0) this.fail(`@${MetadataBuilder.phaseName(phase)} needs an event`);
    for (const event of list) {
      if (typeof event !== "string" || !KNOWN_EVENTS.has(event)) {
        this.fail(`unknown hook event ${JSON.stringify(event)} (events: ${HOOK_EVENTS.join(", ")})`);
      }
    }
    if (typeof fn !== "function") this.fail(`@${MetadataBuilder.phaseName(phase)} must decorate a method`);
    const record = Object.freeze({
      phase,
      events: Object.freeze([...new Set(list as HookEvent[])]),
      fn,
      key,
      owner: this.target,
      ...(this.pluginName === undefined ? {} : { plugin: this.pluginName }),
    });
    this.write((current) => ({ ...current, hooks: Object.freeze([...current.hooks, record]) }));
  }

  /**
   * Registers a plugin on the class.
   *
   * @param plugin - The plugin.
   * @param options - The options passed to `plugin.apply`.
   * @throws {ConfigurationError} When called by a plugin, or `plugin` is not a valid plugin object.
   */
  addPlugin<O>(plugin: SchemaPlugin<O>, options: O): void {
    if (this.pluginName !== undefined) this.fail("a plugin cannot register plugins");
    if (typeof plugin?.apply !== "function" || typeof plugin.name !== "string" || plugin.name === "") {
      this.fail("@Plugin expects a plugin object { name, apply(builder, options) }");
    }
    const record = Object.freeze({ plugin: plugin as SchemaPlugin<unknown>, options, owner: this.target });
    this.write((current) => ({ ...current, plugins: Object.freeze([...current.plugins, record]) }));
  }

  /**
   * Declares the class a discriminator of its parent.
   *
   * @param value - The discriminator value.
   * @throws {ConfigurationError} When called by a plugin, the value is empty, the class is already a
   * discriminator or has no base class.
   */
  setDiscriminator(value: string): void {
    if (this.pluginName !== undefined) this.fail("a plugin cannot declare a discriminator");
    if (typeof value !== "string" || value === "") this.fail("@Discriminator value must be a non-empty string");
    if (this.read().discriminator !== undefined) this.fail("@Discriminator is applied twice");
    const parent = MetadataStore.parentOf(this.target);
    if (parent === undefined) this.fail("@Discriminator needs a base class (class X extends Base)");
    MetadataStore.registerDiscriminator(parent, this.target);
    this.write((current) => ({ ...current, discriminator: Object.freeze({ value }) }));
  }

  /**
   * Validates and records one field.
   *
   * @param key - The property name.
   * @param type - The type thunk.
   * @param options - Field options.
   * @param service - The service role, if any.
   * @throws {ConfigurationError} When the name is invalid or taken, the type is not a thunk, or the options are
   * not an object.
   */
  private addFieldRecord(
    key: string,
    type: () => unknown,
    options: Readonly<Record<string, unknown>>,
    service: ServiceField | undefined,
  ): void {
    this.checkName(key, "@Prop");
    if (typeof type !== "function") {
      this.fail(`@Prop "${key}": the type is required on every field, as a thunk: @Prop(() => String)`);
    }
    if (typeof options !== "object" || options === null) this.fail(`@Prop "${key}": options must be an object`);
    if (this.read().fields.some((field) => field.key === key)) this.fail(`@Prop "${key}" is declared twice`);
    const record = Object.freeze({
      key,
      type,
      options: Object.freeze({ ...options }),
      owner: this.target,
      ...(service === undefined ? {} : { service }),
    });
    this.write((current) => ({ ...current, fields: Object.freeze([...current.fields, record]) }));
  }

  /**
   * Checks a field or virtual name.
   *
   * @param key - The name.
   * @param what - The declaration kind, for the message.
   * @throws {ConfigurationError} When the name is not a string, is forbidden, empty, contains "." or starts
   * with "$".
   */
  private checkName(key: unknown, what: string): void {
    if (typeof key !== "string") this.fail(`${what}: symbol keys are not fields`);
    if (FORBIDDEN_NAMES.has(key)) this.fail(`${what} "${key}": this name is forbidden`);
    if (key === "" || key.includes(".") || key.startsWith("$")) {
      this.fail(`${what} "${key}": a field name cannot be empty, contain "." or start with "$"`);
    }
  }

  /**
   * Throws a `ConfigurationError` naming the class (and the plugin).
   *
   * @param message - The problem.
   * @throws {ConfigurationError} Always.
   */
  private fail(message: string): never {
    const where =
      this.pluginName === undefined ? this.target.name : `${this.target.name} (plugin "${this.pluginName}")`;
    throw new ConfigurationError(`${where}: ${message}`);
  }

  /**
   * The decorator name of a hook phase.
   *
   * @param phase - The phase.
   * @returns `Pre`, `Post` or `PostError`.
   */
  private static phaseName(phase: HookPhase): string {
    return phase === "pre" ? "Pre" : phase === "post" ? "Post" : "PostError";
  }
}
