import { ConfigurationError } from "../../errors/configuration-error.ts";
import { HOOK_EVENTS, type HookEvent, type HookPhase } from "../../hooks/hook-events.ts";
import { PluginRegistry, type PluginUse } from "../../plugins/plugin-registry.ts";
import { ExtensionRegistry } from "../extensions/extension-registry.ts";
import { IndexHelpers } from "../indexes/index-helpers.ts";
import { MetadataBuilder } from "../metadata/metadata-builder.ts";
import { type MergedMetadata, MetadataStore } from "../metadata/metadata-store.ts";
import type {
  ClassRecord,
  ClassRef,
  FieldRecord,
  HookFunction,
  HookRecord,
  IndexRecord,
  PluginDraft,
  PluginPolicies,
  StaticFunction,
} from "../metadata/metadata-types.ts";
import { CollectionNaming, type NamingFunction } from "../naming/collection-naming.ts";
import type { IndexDirection, IndexOptions } from "../options/index-options.ts";
import { SCHEMA_OPTION_KEYS, type SchemaOptions } from "../options/schema-options.ts";
import { BuildChecks } from "./build-checks.ts";
import {
  type CompiledIndex,
  CompiledSchema,
  type DiscriminatorInfo,
  type HookTable,
  type VirtualDefinition,
} from "./compiled-schema.ts";
import { NodeFactory } from "./node-factory.ts";
import type { PathNode } from "./path-node.ts";
import { TypeResolver } from "./type-resolver.ts";

/**
 * What a compile depends on besides the class: connection-level plugins and the naming function.
 *
 * @example
 * ```ts
 * const context: CompileContext = { naming: CollectionNaming.default };
 * const schema = SchemaCompiler.compile(User, context);
 * ```
 */
export interface CompileContext {
  /** Connection-level plugins, applied after the global ones. */
  readonly plugins?: PluginRegistry;
  /** Collection naming. Default: `CollectionNaming.default`. */
  readonly naming?: NamingFunction;
  /** The client's schema extensions (over the global ones). Default: the global registry (`Typemo.use()`). */
  readonly extensions?: ExtensionRegistry;
}

/** The context of a compile without a client. */
const DEFAULT_CONTEXT: CompileContext = Object.freeze({});
/** The discriminator key when the schema sets none. */
const DEFAULT_DISCRIMINATOR_KEY = "__t";

/** Per-context cache: the same class compiled with other plugins (another connection) is another schema. */
const CACHE = new WeakMap<ClassRef, Map<CompileContext, CompiledSchema>>();

/**
 * State of one top-level `compile` call (a unit: recursive schemas finish together).
 *
 * @example
 * ```ts
 * const session: CompileSession = { context, inProgress: new Set(), created: [] };
 * ```
 */
interface CompileSession {
  /** The context of the compile. */
  readonly context: CompileContext;
  /** The classes being compiled now. */
  readonly inProgress: Set<ClassRef>;
  /** The schemas created so far, sealed together at the end. */
  readonly created: CompiledSchema[];
}

/**
 * Compiles decorator metadata into an immutable {@link CompiledSchema}: merges the inheritance chain, applies
 * plugins on a draft, resolves every type, builds the paths tree, the indexes, hooks, virtuals and
 * discriminators, and runs every build-time check. Anything wrong is a `ConfigurationError` with the class and
 * field in the message. Compiled classes are sealed: later decorators or discriminators are errors, not
 * silently ignored.
 */
export class SchemaCompiler {
  /** The compile in progress, if any. */
  private static session: CompileSession | undefined;

  /**
   * The extension registry of a compile: the client's, else the global one.
   *
   * @param session - The compile session.
   * @returns The registry.
   */
  private static extensionsOf(session: CompileSession): ExtensionRegistry {
    return session.context.extensions ?? ExtensionRegistry.global;
  }

  /**
   * The compiled schema of a class (cached per context).
   *
   * @param target - The schema class.
   * @param context - What the compile depends on besides the class.
   * @returns The compiled schema.
   * @throws {ConfigurationError} When the class is not a schema or anything in it is invalid.
   */
  static compile(target: ClassRef, context: CompileContext = DEFAULT_CONTEXT): CompiledSchema {
    const cached = CACHE.get(target)?.get(context);
    if (cached !== undefined) return cached;
    const outer = SchemaCompiler.session;
    if (outer !== undefined && outer.context === context) return SchemaCompiler.compileInSession(target, outer);
    const session: CompileSession = { context, inProgress: new Set(), created: [] };
    SchemaCompiler.session = session;
    try {
      const schema = SchemaCompiler.compileInSession(target, session);
      for (const created of session.created) created.seal(SchemaCompiler.allPaths(created));
      /* Only a successful compile fixes the plugins and the extensions (global and the client's alike): after a
       * failed one the user may still register the plugin or the extension the error named. */
      PluginRegistry.global.seal(target.name);
      context.plugins?.seal(target.name);
      ExtensionRegistry.global.seal(target.name);
      SchemaCompiler.extensionsOf(session).seal(target.name);
      return schema;
    } catch (error) {
      for (const created of session.created) CACHE.get(created.target)?.delete(context);
      throw error;
    } finally {
      SchemaCompiler.session = outer;
    }
  }

  /**
   * The schema of a class used as a model: a document (not `nested`) that declares `_id` (extend `Entity` or
   * declare it).
   *
   * @param target - The model class.
   * @param context - What the compile depends on besides the class.
   * @returns The compiled schema.
   * @throws {ConfigurationError} When the class is nested, has no `_id`, or is otherwise invalid as a model.
   */
  static compileModel(target: ClassRef, context: CompileContext = DEFAULT_CONTEXT): CompiledSchema {
    const schema = SchemaCompiler.compile(target, context);
    if (schema.kind === "nested")
      throw new ConfigurationError(`${target.name}: a nested object (@Schema({ nested: true })) cannot be a model`);
    if (!schema.hasId)
      throw new ConfigurationError(`${target.name}: a model needs an _id field (extend Entity or declare @Prop _id)`);
    /* The top-level _id is always uniquely indexed by the server (Mongoose H507); in a subdocument it is a plain
       field. */
    const id = schema.field("_id");
    if (id?.options.index !== undefined || id?.options.unique !== undefined) {
      throw new ConfigurationError(
        `${target.name}._id: _id is always uniquely indexed by the server; remove index/unique`,
      );
    }
    SchemaCompiler.checkConcurrencyPaths(schema);
    SchemaCompiler.checkSubdocumentOptions(schema);
    return schema;
  }

  /**
   * Every path of an `optimisticConcurrency` list is a path of the model — through subdocuments and arrays of
   * them (`comments.text`, no indexes), a Map's values as `field.$*`. Checked on the compiled model (the
   * subdocument schemas exist by then); a wrong path would silently never version anything.
   *
   * @param schema - The compiled model schema.
   * @throws {ConfigurationError} When a listed path is not a path of the class.
   */
  private static checkConcurrencyPaths(schema: CompiledSchema): void {
    const list = schema.options.optimisticConcurrency;
    if (list === undefined || list === true) return;
    const step = (node: PathNode, segment: string): PathNode | undefined => {
      if (node.kind === "array") return step(node.element, segment);
      if (node.kind === "map") return segment === "$*" ? node.value : undefined;
      if (node.kind === "subdocument" || node.kind === "nested") return node.schema.field(segment);
      return undefined;
    };
    for (const path of list) {
      const [head, ...rest] = path.split(".") as [string, ...string[]];
      let node = schema.field(head);
      for (const segment of rest) node = node === undefined ? undefined : step(node, segment);
      if (node === undefined) {
        throw new ConfigurationError(
          `${schema.name}: optimisticConcurrency names "${path}", which is not a path of the class (subdocument fields as "items.price", a Map's values as "field.$*")`,
        );
      }
    }
  }

  /**
   * `optimisticConcurrency` on a subdocument's schema would be ignored (the root document versions the whole tree):
   * an error, not a silent no-op.
   *
   * @param schema - The compiled model schema.
   * @throws {ConfigurationError} When a subdocument's schema sets `optimisticConcurrency`.
   */
  private static checkSubdocumentOptions(schema: CompiledSchema): void {
    for (const node of Object.values(schema.allPaths)) {
      if (node.kind !== "subdocument" || node.schema.options.optimisticConcurrency === undefined) continue;
      throw new ConfigurationError(
        `${node.schema.name}: option "optimisticConcurrency" is for the documents of a model — the subdocument at "${node.path}" of ${schema.name} is versioned by its root (set it on ${schema.name})`,
      );
    }
  }

  /**
   * Compiles a class inside a session, sealing the class metadata (the registries are sealed by `compile` once
   * the whole session succeeded).
   *
   * @param target - The schema class.
   * @param session - The compile session.
   * @returns The compiled schema.
   * @throws {ConfigurationError} When the class is not a schema, refers to itself, or is invalid.
   */
  private static compileInSession(target: ClassRef, session: CompileSession): CompiledSchema {
    const cached = CACHE.get(target)?.get(session.context);
    if (cached !== undefined) return cached;
    if (session.inProgress.has(target)) {
      throw new ConfigurationError(
        `${target.name}: the schema refers to itself before it is compiled (a recursive default?)`,
      );
    }
    if (typeof target !== "function")
      throw new ConfigurationError(`SchemaCompiler: expected a class, got ${typeof target}`);
    if (!MetadataStore.isSchema(target)) {
      throw new ConfigurationError(`${target.name}: not a schema; decorate the class with @Schema()`);
    }
    session.inProgress.add(target);
    try {
      const schema = SchemaCompiler.build(target, session);
      let byContext = CACHE.get(target);
      if (byContext === undefined) {
        byContext = new Map();
        CACHE.set(target, byContext);
      }
      byContext.set(session.context, schema);
      session.created.push(schema);
      MetadataStore.seal(target);
      return schema;
    } finally {
      session.inProgress.delete(target);
    }
  }

  /**
   * A resolver of the schema of a class for a node: compiled now, or later when it is in progress (recursive
   * schemas).
   *
   * @param session - The compile session.
   * @returns A function from a class to its compiled schema.
   */
  private static schemaOf(session: CompileSession) {
    return (target: ClassRef): CompiledSchema => {
      const cached = CACHE.get(target)?.get(session.context);
      if (cached !== undefined) return cached;
      return SchemaCompiler.compile(target, session.context);
    };
  }

  /**
   * Builds the schema of a class: merges the metadata, applies plugins, builds the nodes, indexes, virtuals and
   * hooks, and runs every build-time check.
   *
   * @param target - The schema class.
   * @param session - The compile session.
   * @returns The compiled (not yet sealed) schema.
   * @throws {ConfigurationError} When anything in the class is invalid.
   */
  private static build(target: ClassRef, session: CompileSession): CompiledSchema {
    const own = MetadataStore.own(target);
    const hierarchy = SchemaCompiler.hierarchy(target);
    const rootOptions = MetadataStore.own(hierarchy.root).schema ?? {};
    if (own.discriminator !== undefined && own.schema !== undefined) {
      throw new ConfigurationError(
        `${target.name}: a discriminator uses its root's schema options; remove @Schema (root: ${hierarchy.root.name})`,
      );
    }
    const declared: SchemaOptions = own.discriminator !== undefined ? rootOptions : (own.schema ?? {});
    const options: SchemaOptions = declared;
    const nested = options.nested === true;
    const discriminatorKey = rootOptions.discriminatorKey ?? DEFAULT_DISCRIMINATOR_KEY;
    const discriminatorChildren = SchemaCompiler.descendants(hierarchy.root);
    const hasHierarchy = discriminatorChildren.length > 0;
    SchemaCompiler.checkDiscriminatorValues(hierarchy.root, discriminatorChildren);
    SchemaCompiler.checkDiscriminatorList(hierarchy.root, rootOptions, discriminatorChildren);

    const merged = MetadataStore.merged(target);
    const applied = SchemaCompiler.applyPlugins(target, merged, session, nested);
    const record = applied.draft.record;
    const withPolicies = SchemaCompiler.pluginPolicies(target, options, applied.draft, own.discriminator !== undefined);
    const fields = SchemaCompiler.withDiscriminatorKey(target, record.fields, discriminatorKey, hasHierarchy, options);
    const where = (key: string): string => `${target.name}.${key}`;
    /* A discriminator shares its root's options, so its root's `ext` too (checked again, same result). */
    const schemaExt = SchemaCompiler.extensionsOf(session).schema(options.ext, {
      name: target.name,
      kind: nested ? "nested" : "document",
      discriminator: own.discriminator?.value,
    });

    SchemaCompiler.checkNested(target, nested, own, record, hasHierarchy, options);
    SchemaCompiler.checkOverrides(target, merged);
    const keys = fields.map((field) => field.key);
    BuildChecks.nameClashes(target, keys);
    const instance = BuildChecks.construct(target);
    BuildChecks.deterministic(target, instance, BuildChecks.construct(target));
    const fieldKeys = [...keys, ...record.virtuals.map((virtual) => virtual.key)];
    BuildChecks.initializers(target, instance, fieldKeys);
    BuildChecks.undeclared(target, instance, fieldKeys);

    const site = {
      prefix: "",
      dbPrefix: "",
      extensions: SchemaCompiler.extensionsOf(session),
      schemaOf: SchemaCompiler.schemaOf(session),
    };
    const nodes = fields.map((field) =>
      NodeFactory.build(
        field.key,
        TypeResolver.resolve(SchemaCompiler.callThunk(field, target), where(field.key)),
        field.options,
        {
          ...site,
          where: where(field.key),
          owner: field.owner,
          service: field.service ?? (hasHierarchy && field.key === discriminatorKey ? "discriminatorKey" : undefined),
        },
      ),
    );
    SchemaCompiler.checkDiscriminatorKeyNode(target, nodes, discriminatorKey, hasHierarchy);
    SchemaCompiler.checkDbNames(target, nodes);
    SchemaCompiler.checkIdField(target, nodes, nested);
    SchemaCompiler.checkDocumentOptions(target, nodes, options);
    const paths = SchemaCompiler.flatten(nodes);

    const discriminator: DiscriminatorInfo | undefined =
      own.discriminator === undefined
        ? undefined
        : { root: hierarchy.root, key: discriminatorKey, value: own.discriminator.value };
    const collection = CollectionNaming.check(
      options.collection ?? (session.context.naming ?? CollectionNaming.default)(hierarchy.root.name),
      `${target.name}: collection`,
    );

    /* Discriminator schemas are compiled with the root (their indexes are the root collection's). */
    const isRoot = target === hierarchy.root;
    const discriminatorSchemas = isRoot
      ? SchemaCompiler.compileDiscriminators(discriminatorChildren, session)
      : undefined;
    const indexes = SchemaCompiler.indexes(
      target,
      nodes,
      paths,
      record.indexes,
      options,
      session,
      discriminatorSchemas,
      hierarchy.root,
    );
    const virtuals = SchemaCompiler.virtuals(target, record, paths, keys);
    const hooks = SchemaCompiler.hooks(record.hooks);
    SchemaCompiler.checkTimeSeries(target, options, paths);
    SchemaCompiler.checkCollectionOptions(target, options, paths, indexes);
    SchemaCompiler.checkPolicies(target, withPolicies, paths, applied.draft.record.tenantFields);

    const context = session.context;
    return new CompiledSchema({
      target,
      kind: nested ? "nested" : "document",
      options: Object.freeze(schemaExt === undefined ? { ...withPolicies } : { ...withPolicies, ext: schemaExt }),
      collection,
      fields: Object.freeze(nodes),
      paths,
      indexes,
      searchIndexes: Object.freeze(record.searchIndexes.map((index) => index.options)),
      virtuals,
      hooks,
      statics: new Map([...applied.draft.statics].map(([name, entry]) => [name, entry.fn] as const)),
      plugins: Object.freeze(applied.names),
      discriminator,
      discriminatorKey,
      discriminators: isRoot
        ? () => discriminatorSchemas ?? new Map()
        : () => SchemaCompiler.compile(hierarchy.root, context).discriminators,
      root: () => SchemaCompiler.compile(hierarchy.root, context),
    });
  }

  /**
   * Calls the type thunk of a field.
   *
   * @param field - The field record.
   * @param target - The class being compiled.
   * @returns What the thunk returned.
   * @throws {ConfigurationError} When the thunk throws.
   */
  private static callThunk(field: FieldRecord, target: ClassRef): unknown {
    try {
      return field.type();
    } catch (error) {
      throw new ConfigurationError(
        `${target.name}.${field.key}: the type thunk threw (a class used before its declaration, or a module cycle with emitDecoratorMetadata?)`,
        { cause: error },
      );
    }
  }

  /**
   * The root of a discriminator hierarchy: the nearest ancestor without `@Discriminator`.
   *
   * @param target - The class.
   * @returns The root class.
   * @throws {ConfigurationError} When a discriminator has no base class or its root has no `@Schema`.
   */
  private static hierarchy(target: ClassRef): { readonly root: ClassRef } {
    let current = target;
    while (MetadataStore.own(current).discriminator !== undefined) {
      const parent = MetadataStore.parentOf(current);
      if (parent === undefined) throw new ConfigurationError(`${current.name}: @Discriminator needs a base class`);
      current = parent;
    }
    if (current !== target && !MetadataStore.isSchema(current)) {
      throw new ConfigurationError(
        `${target.name}: the root of its discriminator hierarchy (${current.name}) has no @Schema`,
      );
    }
    return { root: current };
  }

  /**
   * All registered discriminators below `root`, depth first, in registration order.
   *
   * @param root - The root class.
   * @returns The discriminator classes.
   */
  private static descendants(root: ClassRef): ClassRef[] {
    return MetadataStore.discriminatorsOf(root).flatMap((child) => [child, ...SchemaCompiler.descendants(child)]);
  }

  /**
   * Every discriminator value is used once in a hierarchy. Checked from the metadata by every class of the
   * hierarchy (the root and each discriminator), so `model(Child)` reports a repeated value itself instead of
   * leaving it to a later compile of the root.
   *
   * @param root - The root class.
   * @param children - The discriminator classes below the root, in registration order.
   * @throws {ConfigurationError} When two classes use the same discriminator value (the later one is named).
   */
  private static checkDiscriminatorValues(root: ClassRef, children: readonly ClassRef[]): void {
    const seen = new Map<string, ClassRef>();
    const rootValue = MetadataStore.own(root).discriminator?.value;
    if (rootValue !== undefined) seen.set(rootValue, root);
    for (const child of children) {
      const value = MetadataStore.own(child).discriminator?.value as string;
      const existing = seen.get(value);
      if (existing !== undefined) {
        throw new ConfigurationError(
          `${child.name}: discriminator value "${value}" is already used by ${existing.name} in the hierarchy of ${root.name}`,
        );
      }
      seen.set(value, child);
    }
  }

  /**
   * The `discriminators` option of a root names exactly the classes registered below it by `@Discriminator`.
   * Checked by every class of the hierarchy, as the values are.
   *
   * @param root - The root class.
   * @param options - The root's schema options.
   * @param children - The discriminator classes below the root, in registration order.
   * @throws {ConfigurationError} When the option is not a thunk of a list of classes, when a registered
   * discriminator is missing from it, or when it lists a class that is not a discriminator of the root.
   */
  private static checkDiscriminatorList(root: ClassRef, options: SchemaOptions, children: readonly ClassRef[]): void {
    const option: unknown = options.discriminators;
    if (option === undefined) return;
    const shape = `${root.name}: "discriminators" must be a thunk returning a list of classes: () => [Child, …]`;
    if (typeof option !== "function") throw new ConfigurationError(shape);
    const listed: unknown = (option as () => unknown)();
    if (!Array.isArray(listed) || listed.some((item: unknown) => typeof item !== "function")) {
      throw new ConfigurationError(shape);
    }
    const classes = listed as readonly ClassRef[];
    const missing = children.filter((child) => !classes.includes(child));
    const extra = classes.filter((item) => !children.includes(item));
    if (missing.length === 0 && extra.length === 0 && new Set(classes).size === classes.length) return;
    const problems: string[] = [];
    if (missing.length > 0) {
      problems.push(`registered but not listed: ${missing.map((child) => child.name).join(", ")}`);
    }
    if (extra.length > 0) {
      problems.push(
        `listed but not a @Discriminator class below ${root.name}: ${extra.map((item) => item.name || "(anonymous)").join(", ")}`,
      );
    }
    if (new Set(classes).size !== classes.length) problems.push("a class is listed twice");
    throw new ConfigurationError(
      `${root.name}: the "discriminators" list does not match the hierarchy — ${problems.join("; ")}`,
    );
  }

  /**
   * Compiles the discriminator classes of a root (their values are unique: see `checkDiscriminatorValues`).
   *
   * @param children - The discriminator classes.
   * @param session - The compile session.
   * @returns The compiled schemas by discriminator value.
   */
  private static compileDiscriminators(
    children: readonly ClassRef[],
    session: CompileSession,
  ): ReadonlyMap<string, CompiledSchema> {
    const map = new Map<string, CompiledSchema>();
    for (const child of children) {
      const value = MetadataStore.own(child).discriminator?.value as string;
      map.set(value, SchemaCompiler.compileInSession(child, session));
    }
    return map;
  }

  /**
   * The field records with the discriminator key added, when the class has a hierarchy and does not declare it.
   *
   * @param target - The class.
   * @param fields - The declared field records.
   * @param key - The discriminator key.
   * @param hasHierarchy - Whether the class has discriminators.
   * @param options - The schema options.
   * @returns The field records.
   * @throws {ConfigurationError} When `discriminatorKey` is set but not declared as a field (and no `discriminators` list).
   */
  private static withDiscriminatorKey(
    target: ClassRef,
    fields: readonly FieldRecord[],
    key: string,
    hasHierarchy: boolean,
    options: SchemaOptions,
  ): readonly FieldRecord[] {
    const declared = fields.some((field) => field.key === key);
    /* With a `discriminators` list the key is declared in the type only (`declare readonly kind?: Discriminators<…>`)
       and the core adds it as it adds `__t`. */
    if (options.discriminatorKey !== undefined && !declared && hasHierarchy && options.discriminators === undefined) {
      throw new ConfigurationError(
        `${target.name}: discriminatorKey "${key}" is not a declared field (declare it as a string field, or list the discriminators and declare readonly ${key}?: Discriminators<…>)`,
      );
    }
    if (!hasHierarchy || declared) return fields;
    return [
      ...fields,
      Object.freeze({
        key,
        type: () => String,
        options: Object.freeze({}),
        owner: target,
        service: "discriminatorKey" as const,
      }),
    ];
  }

  /**
   * Checks that the discriminator key is a non-nullable string field.
   *
   * @param target - The class.
   * @param nodes - The field nodes.
   * @param key - The discriminator key.
   * @param hasHierarchy - Whether the class has discriminators.
   * @throws {ConfigurationError} When the key field has another type.
   */
  private static checkDiscriminatorKeyNode(
    target: ClassRef,
    nodes: readonly PathNode[],
    key: string,
    hasHierarchy: boolean,
  ): void {
    if (!hasHierarchy) return;
    const node = nodes.find((candidate) => candidate.key === key);
    if (node === undefined || node.kind !== "scalar" || node.type !== "string" || node.nullable) {
      throw new ConfigurationError(
        `${target.name}: the discriminator key "${key}" must be a non-nullable string field`,
      );
    }
  }

  /**
   * A subclass may redeclare a base field only with the same type.
   *
   * @param target - The class.
   * @param merged - The merged metadata.
   * @throws {ConfigurationError} When a redeclared field has another type.
   */
  private static checkOverrides(target: ClassRef, merged: MergedMetadata): void {
    for (const base of merged.overridden) {
      const derived = merged.fields.find((field) => field.key === base.key);
      if (derived === undefined) continue;
      const a = SchemaCompiler.typeSignature(
        TypeResolver.resolve(SchemaCompiler.callThunk(base, target), `${base.owner.name}.${base.key}`),
      );
      const b = SchemaCompiler.typeSignature(
        TypeResolver.resolve(SchemaCompiler.callThunk(derived, target), `${derived.owner.name}.${derived.key}`),
      );
      if (a !== b) {
        throw new ConfigurationError(
          `${target.name}.${base.key}: redeclared with another type (${b} in ${derived.owner.name}, ${a} in ${base.owner.name})`,
        );
      }
    }
  }

  /**
   * A comparable text form of a resolved type.
   *
   * @param spec - The resolved spec.
   * @returns The signature, such as `string`, `number[]` or `Map<objectId>`.
   */
  private static typeSignature(spec: ReturnType<typeof TypeResolver.resolve>): string {
    switch (spec.kind) {
      case "scalar":
        return spec.type;
      case "union":
        return spec.members.join("|");
      case "array":
        return `${SchemaCompiler.typeSignature(spec.element)}[]`;
      case "map":
        return `Map<${SchemaCompiler.typeSignature(spec.value)}>`;
      case "class":
        return spec.target.name;
    }
  }

  /**
   * The schema options with the policies plugins enabled. A policy the class declares too must have the same
   * options; a discriminator keeps its root's options.
   *
   * @param target - The class.
   * @param options - The declared schema options.
   * @param draft - The draft the plugins wrote into.
   * @param discriminator - Whether the class is a discriminator.
   * @returns The schema options with the plugin policies.
   * @throws {ConfigurationError} When a policy is declared with other options than the plugin enables it with.
   */
  private static pluginPolicies(
    target: ClassRef,
    options: SchemaOptions,
    draft: PluginDraft,
    discriminator: boolean,
  ): SchemaOptions {
    const entries = Object.entries(draft.policies) as [
      keyof PluginPolicies & string,
      { readonly value: unknown; readonly plugin: string },
    ][];
    if (entries.length === 0 || discriminator) return options;
    const out: Record<string, unknown> = { ...options };
    for (const [policy, entry] of entries) {
      const declared = options[policy];
      if (declared !== undefined && JSON.stringify(declared) !== JSON.stringify(entry.value)) {
        throw new ConfigurationError(
          `${target.name}: policy "${policy}" is declared by @Schema and enabled by plugin "${entry.plugin}" with other options`,
        );
      }
      out[policy] = entry.value;
    }
    return Object.freeze(out) as SchemaOptions;
  }

  /**
   * Applies the global, connection and model plugins on a draft of the class record.
   *
   * @param target - The class.
   * @param merged - The merged metadata.
   * @param session - The compile session.
   * @param nested - Whether the class is a nested object.
   * @returns The draft and the names of the applied plugins.
   * @throws {ConfigurationError} When a plugin throws or its statics are invalid.
   */
  private static applyPlugins(
    target: ClassRef,
    merged: MergedMetadata,
    session: CompileSession,
    nested: boolean,
  ): { readonly draft: PluginDraft; readonly names: readonly string[] } {
    const modelUses: PluginUse[] = [];
    /* `merged.plugins` is base first, source order within a class. */
    for (const use of merged.plugins) modelUses.push({ plugin: use.plugin, options: use.options, level: "model" });
    /* Global and connection plugins apply to documents (roots and subdocuments), not to nested objects:
       a nested object is a group of its parent's fields, with no hooks of its own. */
    const shared = nested ? [] : [...PluginRegistry.global.list, ...(session.context.plugins?.list ?? [])];
    const uses = PluginRegistry.resolve([...shared, ...modelUses], target.name);
    const draft: PluginDraft = {
      statics: new Map(),
      policies: {},
      record: Object.freeze({
        schema: undefined,
        fields: merged.fields,
        indexes: merged.indexes,
        searchIndexes: merged.searchIndexes,
        virtuals: merged.virtuals,
        hooks: merged.hooks,
        plugins: Object.freeze([]),
        discriminator: undefined,
        tenantFields: merged.tenantFields,
      }),
    };
    for (const use of uses) {
      try {
        const builder = MetadataBuilder.draft(target, draft, use.plugin.name);
        use.plugin.apply(builder, use.options);
        /* The plugin's `statics` object (typed by `model.statics(plugin)`). */
        const statics = (use.plugin as { readonly statics?: unknown }).statics;
        if (statics !== undefined) {
          if (typeof statics !== "object" || statics === null) {
            throw new ConfigurationError(
              `${target.name}: plugin "${use.plugin.name}": statics is an object of functions`,
            );
          }
          for (const [name, fn] of Object.entries(statics)) builder.addStatic(name, fn as StaticFunction);
        }
      } catch (error) {
        if (error instanceof ConfigurationError) throw error;
        throw new ConfigurationError(`${target.name}: plugin "${use.plugin.name}" threw`, { cause: error });
      }
    }
    return { draft, names: uses.map((use) => use.plugin.name) };
  }

  /**
   * Checks that a nested object has nothing that only a document can have.
   *
   * @param target - The class.
   * @param nested - Whether the class is a nested object.
   * @param own - The class's own record.
   * @param record - The record with plugins applied.
   * @param hasHierarchy - Whether the class has discriminators.
   * @param options - The schema options.
   * @throws {ConfigurationError} When a nested object declares `_id`, hooks, discriminators or document-only
   * options.
   */
  private static checkNested(
    target: ClassRef,
    nested: boolean,
    own: ClassRecord,
    record: ClassRecord,
    hasHierarchy: boolean,
    options: SchemaOptions,
  ): void {
    if (!nested) return;
    const problems: string[] = [];
    if (record.fields.some((field) => field.key === "_id")) problems.push("it declares _id");
    if (record.hooks.length > 0) problems.push("it has hooks");
    if (hasHierarchy || own.discriminator !== undefined) problems.push("it has discriminators");
    for (const option of [
      "collection",
      "timeseries",
      "capped",
      "clustered",
      "changeStreamPreAndPostImages",
      "validator",
      "tenant",
      "softDelete",
      "audit",
      "discriminatorKey",
      "discriminators",
      "optimisticConcurrency",
      "shardKey",
    ] as const) {
      if (options[option] !== undefined) problems.push(`option "${option}" is for documents`);
    }
    if (problems.length > 0) {
      throw new ConfigurationError(`${target.name}: a nested object (no _id, no own hooks) — ${problems.join("; ")}`);
    }
  }

  /**
   * Checks that no two fields are stored under the same name, and no `dbName` is another field's name.
   *
   * @param target - The class.
   * @param nodes - The field nodes.
   * @throws {ConfigurationError} On a `dbName` conflict.
   */
  private static checkDbNames(target: ClassRef, nodes: readonly PathNode[]): void {
    const seen = new Map<string, string>();
    for (const node of nodes) {
      const clash = seen.get(node.dbKey);
      if (clash !== undefined) {
        throw new ConfigurationError(
          `${target.name}: fields "${clash}" and "${node.key}" are both stored as "${node.dbKey}" (dbName conflict)`,
        );
      }
      seen.set(node.dbKey, node.key);
    }
    for (const node of nodes) {
      if (node.dbKey !== node.key && nodes.some((other) => other !== node && other.key === node.dbKey)) {
        throw new ConfigurationError(
          `${target.name}: dbName "${node.dbKey}" of "${node.key}" is the name of another field`,
        );
      }
    }
  }

  /**
   * Checks the document options: `optimisticConcurrency` needs a version field, `shardKey` names top-level
   * fields, and the removed `toJSON` / `toObject` options are refused.
   *
   * @param target - The class.
   * @param nodes - The field nodes.
   * @param options - The schema options.
   * @throws {ConfigurationError} When an option is invalid.
   */
  private static checkDocumentOptions(target: ClassRef, nodes: readonly PathNode[], options: SchemaOptions): void {
    if (options.optimisticConcurrency !== undefined && !nodes.some((node) => node.service === "version")) {
      throw new ConfigurationError(
        `${target.name}: optimisticConcurrency needs the version field — extend Versioned(...)`,
      );
    }
    const concurrency: unknown = options.optimisticConcurrency;
    if (concurrency !== undefined && concurrency !== true) {
      if (
        !Array.isArray(concurrency) ||
        concurrency.length === 0 ||
        !concurrency.every((path) => typeof path === "string" && path !== "")
      ) {
        throw new ConfigurationError(`${target.name}: optimisticConcurrency is true or a non-empty list of paths`);
      }
      if (new Set(concurrency).size !== concurrency.length) {
        throw new ConfigurationError(`${target.name}: optimisticConcurrency lists a path twice`);
      }
    }
    for (const option of ["toJSON", "toObject"]) {
      /* No schema-level serialization defaults (the type of `$toJSON()` could not follow them); a JavaScript
         caller (or a Mongoose habit) gets an error instead of options silently ignored. */
      if (Object.hasOwn(options, option)) {
        throw new ConfigurationError(
          `${target.name}: @Schema has no "${option}" option — pass serialization options to each $toJSON()/$toObject()/$toPlain() call`,
        );
      }
    }
    for (const key of Object.keys(options)) {
      /* A JavaScript caller (or a Mongoose habit: strict, strictQuery, timestamps, versionKey) gets an error
         instead of an option that does nothing. */
      if (!SCHEMA_OPTION_KEYS.includes(key)) {
        throw new ConfigurationError(
          `${target.name}: @Schema has no "${key}" option (the options are: ${SCHEMA_OPTION_KEYS.join(", ")})`,
        );
      }
    }
    for (const [key, kind] of Object.entries(options.shardKey ?? {})) {
      if (!nodes.some((node) => node.key === key)) {
        throw new ConfigurationError(`${target.name}: shardKey names "${key}", which is not a top-level field`);
      }
      if (kind !== 1 && kind !== "hashed") {
        throw new ConfigurationError(`${target.name}: shardKey "${key}" must be 1 or "hashed"`);
      }
    }
  }

  /**
   * Checks the `_id` field of a document.
   *
   * @param target - The class.
   * @param nodes - The field nodes.
   * @param nested - Whether the class is a nested object (reported by `checkNested`).
   * @throws {ConfigurationError} When `_id` has a `dbName`, is nullable, or is an array.
   */
  private static checkIdField(target: ClassRef, nodes: readonly PathNode[], nested: boolean): void {
    const id = nodes.find((node) => node.key === "_id");
    if (id === undefined) return;
    if (nested) return;
    if (id.dbKey !== "_id") throw new ConfigurationError(`${target.name}._id: _id cannot have a dbName`);
    if (id.nullable) throw new ConfigurationError(`${target.name}._id: _id cannot be nullable`);
    if (id.kind === "array") throw new ConfigurationError(`${target.name}._id: _id cannot be an array`);
  }

  /**
   * Paths of this schema: fields, nested objects inlined, array elements (`$`) and map values (`$*`).
   *
   * @param nodes - The field nodes.
   * @returns The frozen paths by canonical code path.
   */
  private static flatten(nodes: readonly PathNode[]): Readonly<Record<string, PathNode>> {
    const paths: Record<string, PathNode> = Object.create(null) as Record<string, PathNode>;
    const add = (node: PathNode, path: string, dbPath: string): void => {
      const placed = path === node.path ? node : SchemaCompiler.rebase(node, path, dbPath);
      paths[path] = placed;
      switch (placed.kind) {
        case "array":
          add(placed.element, `${path}.$`, `${dbPath}.$`);
          break;
        case "map":
          add(placed.value, `${path}.$*`, `${dbPath}.$*`);
          break;
        case "nested":
          for (const child of placed.schema.fields) add(child, `${path}.${child.key}`, `${dbPath}.${child.dbKey}`);
          break;
        default:
          break;
      }
    };
    for (const node of nodes) add(node, node.path, node.dbPath);
    return Object.freeze(paths);
  }

  /**
   * A copy of a node at another path (children rebased too); getters are kept as getters.
   *
   * @param node - The node.
   * @param path - The new code path.
   * @param dbPath - The new database path.
   * @returns The rebased node.
   */
  private static rebase(node: PathNode, path: string, dbPath: string): PathNode {
    const descriptors = Object.getOwnPropertyDescriptors(node);
    const extra: PropertyDescriptorMap = {
      path: { value: path, enumerable: true },
      dbPath: { value: dbPath, enumerable: true },
    };
    if (node.kind === "array")
      extra.element = { value: SchemaCompiler.rebase(node.element, `${path}.$`, `${dbPath}.$`), enumerable: true };
    if (node.kind === "map")
      extra.value = { value: SchemaCompiler.rebase(node.value, `${path}.$*`, `${dbPath}.$*`), enumerable: true };
    return Object.freeze(Object.defineProperties({}, { ...descriptors, ...extra }) as PathNode);
  }

  /**
   * Every path of the tree (through subdocuments; a recursive schema is entered once).
   *
   * @param schema - The compiled schema.
   * @returns The frozen paths by canonical code path.
   */
  private static allPaths(schema: CompiledSchema): Readonly<Record<string, PathNode>> {
    const out: Record<string, PathNode> = Object.create(null) as Record<string, PathNode>;
    const visit = (current: CompiledSchema, prefix: string, dbPrefix: string, stack: readonly ClassRef[]): void => {
      for (const [path, node] of Object.entries(current.paths)) {
        const full = prefix === "" ? path : `${prefix}.${path}`;
        const fullDb = dbPrefix === "" ? node.dbPath : `${dbPrefix}.${node.dbPath}`;
        out[full] = prefix === "" ? node : SchemaCompiler.rebase(node, full, fullDb);
        if (node.kind === "subdocument" && !stack.includes(node.target)) {
          visit(node.schema, full, fullDb, [...stack, node.target]);
        }
      }
    };
    visit(schema, "", "", [schema.target]);
    return Object.freeze(out);
  }

  /**
   * Collects and checks the indexes of a schema: field options, `@Index` and plugin indexes, indexes of
   * subdocuments and nested objects (prefixed with their path), a merged text index, and the indexes of the
   * discriminators (scoped to their documents).
   *
   * @param target - The class.
   * @param nodes - The field nodes.
   * @param paths - The paths of the schema.
   * @param records - The `@Index` records (and plugin indexes).
   * @param options - The schema options.
   * @param session - The compile session.
   * @param discriminators - The compiled discriminator schemas of a root, if any.
   * @param root - The root class of the hierarchy.
   * @returns The frozen indexes to create.
   * @throws {ConfigurationError} When an index names a path that is not a field, or is invalid.
   */
  private static indexes(
    target: ClassRef,
    nodes: readonly PathNode[],
    paths: Readonly<Record<string, PathNode>>,
    records: readonly IndexRecord[],
    options: SchemaOptions,
    session: CompileSession,
    discriminators: ReadonlyMap<string, CompiledSchema> | undefined,
    root: ClassRef,
  ): readonly CompiledIndex[] {
    const out: CompiledIndex[] = [];
    const textKeys: Record<string, IndexDirection> = {};
    let textOwner: ClassRef = target;
    const toDb = (path: string): string => SchemaCompiler.dbPathOf(target, path, paths, session);

    /* 1. Field options, on this schema's own paths (nested objects come through their own schema, step 3). */
    const visitField = (node: PathNode): void => {
      if (node.options.text === true) textOwner = node.owner ?? target;
      SchemaCompiler.fieldIndex(target, node, out, textKeys);
      if (node.kind === "array") visitField(node.element);
      if (node.kind === "map") visitField(node.value);
    };
    for (const node of nodes) visitField(node);

    /* 2. @Index (and plugin indexes). */
    for (const record of records) {
      const where = `${target.name}: @Index(${JSON.stringify(record.fields)})`;
      for (const path of Object.keys(record.fields)) {
        if (path === "$**" || path.endsWith(".$**")) {
          if (path !== "$**") toDb(path.slice(0, -4));
          continue;
        }
        if (SchemaCompiler.dbPathOrUndefined(path, paths, session) === undefined) {
          throw new ConfigurationError(`${where}: "${path}" is not a field of the class`);
        }
      }
      const keys = IndexHelpers.mapKeys(record.fields, (path) =>
        path === "$**" ? path : path.endsWith(".$**") ? `${toDb(path.slice(0, -4))}.$**` : toDb(path),
      );
      const indexOptions = SchemaCompiler.mapIndexOptions(record.options, toDb, where, paths, session);
      if (indexOptions.expireAfterSeconds !== undefined)
        SchemaCompiler.checkTtl(where, Object.keys(record.fields), paths, session);
      out.push(
        Object.freeze({
          keys,
          options: indexOptions,
          source: IndexHelpers.isText(keys) ? "text" : "class",
          owner: record.owner,
        }),
      );
    }

    /* 3. Indexes of subdocuments and nested objects, prefixed with their path (arrays of subdocuments too:
       Mongoose skipped them, gh-6113). A recursive subdocument that is still compiling adds none. */
    for (const node of Object.values(paths)) {
      if (node.kind !== "subdocument" && node.kind !== "nested") continue;
      if (node.options.excludeIndexes === true) continue;
      const child = CACHE.get(node.target)?.get(session.context);
      if (child === undefined && session.inProgress.has(node.target)) continue;
      const childSchema = child ?? node.schema;
      const prefix = node.dbPath
        .split(".")
        .filter((segment) => segment !== "$" && segment !== "$*")
        .join(".");
      for (const index of childSchema.indexes) {
        const map = IndexHelpers.prefix(prefix);
        const keys = IndexHelpers.mapKeys(index.keys, map);
        const options = Object.freeze({
          ...index.options,
          ...(index.options.partialFilterExpression === undefined
            ? {}
            : { partialFilterExpression: IndexHelpers.mapFilter(index.options.partialFilterExpression, map) }),
          ...(index.options.weights === undefined
            ? {}
            : {
                weights: Object.fromEntries(
                  Object.entries(index.options.weights).map(([path, weight]) => [map(path), weight]),
                ),
              }),
        });
        if (index.source === "text" && index.options.weights === undefined && index.options.name === undefined) {
          Object.assign(textKeys, keys);
          textOwner = index.owner;
        } else {
          out.push(Object.freeze({ keys, options, source: index.source, owner: index.owner }));
        }
      }
    }

    if (Object.keys(textKeys).length > 0) {
      out.push(
        Object.freeze({
          keys: Object.freeze({ ...textKeys }),
          options: Object.freeze({}),
          source: "text",
          owner: textOwner,
        }),
      );
    }

    /* 4. The root collection also holds the indexes of its discriminators, scoped to their documents. */
    if (discriminators !== undefined) {
      const rootChain = MetadataStore.chain(root);
      for (const [value, schema] of discriminators) {
        for (const index of schema.indexes) {
          if (rootChain.includes(index.owner)) continue;
          if (
            out.some((existing) => IndexHelpers.sameKeys(existing.keys, index.keys) && existing.owner === index.owner)
          )
            continue;
          out.push(
            Object.freeze({
              keys: index.keys,
              options: IndexHelpers.scopeToDiscriminator(index.options, schema.discriminatorKey, value),
              source: index.source,
              owner: index.owner,
            }),
          );
        }
      }
    }

    return SchemaCompiler.checkIndexes(target, out, options);
  }

  /**
   * The index a field's options (`index`, `unique`, `sparse`, `expires`, `text`) ask for.
   *
   * @param target - The class.
   * @param node - The field node.
   * @param out - The list of indexes to add to.
   * @param textKeys - The keys of the merged text index to add to.
   * @throws {ConfigurationError} When the options are inconsistent (for example `unique` on an optional field).
   */
  private static fieldIndex(
    target: ClassRef,
    node: PathNode,
    out: CompiledIndex[],
    textKeys: Record<string, IndexDirection>,
  ): void {
    const { index, unique, sparse, expires, text } = node.options;
    const where = `${target.name}.${node.path}`;
    const dbPath = node.dbPath
      .split(".")
      .filter((segment) => segment !== "$" && segment !== "$*")
      .join(".");
    if (text === true) textKeys[dbPath] = "text";
    if (index === undefined && unique === undefined && expires === undefined) {
      if (sparse !== undefined) throw new ConfigurationError(`${where}: "sparse" needs "index" or "unique"`);
      return;
    }
    if (unique === true && !node.required && sparse !== true) {
      throw new ConfigurationError(
        `${where}: "unique" on a field that is not required — every document without it is indexed as null and the second one fails (E11000); add required: true, sparse: true or use a partial @Index`,
      );
    }
    if (unique === true && node.nullable) {
      throw new ConfigurationError(
        `${where}: "unique" on a nullable field — null values collide even in a sparse index; use a partial @Index`,
      );
    }
    if (expires !== undefined && (typeof expires !== "number" || !Number.isInteger(expires) || expires < 0)) {
      throw new ConfigurationError(`${where}: "expires" is a non-negative whole number of seconds`);
    }
    const direction: IndexDirection = index === undefined || index === true ? 1 : (index as IndexDirection);
    if (![1, -1, "hashed"].includes(direction))
      throw new ConfigurationError(`${where}: "index" must be true, 1, -1 or "hashed"`);
    const options: IndexOptions = {
      ...(unique === true ? { unique: true } : {}),
      ...(sparse === true ? { sparse: true } : {}),
      ...(typeof expires === "number" ? { expireAfterSeconds: expires } : {}),
    };
    out.push(
      Object.freeze({
        keys: Object.freeze({ [dbPath]: direction }),
        options: Object.freeze(options),
        source: "field",
        owner: node.owner ?? target,
      }),
    );
  }

  /**
   * Maps the paths inside index options (`partialFilterExpression`, `weights`) to database paths.
   *
   * @param options - The index options.
   * @param toDb - Maps a code path to a database path.
   * @param where - The index, for messages.
   * @param paths - The paths of the schema.
   * @param session - The compile session.
   * @returns The frozen options.
   * @throws {ConfigurationError} When an option names a path that is not a field, or `sparse` is combined with
   * `partialFilterExpression`.
   */
  private static mapIndexOptions(
    options: IndexOptions,
    toDb: (path: string) => string,
    where: string,
    paths: Readonly<Record<string, PathNode>>,
    session: CompileSession,
  ): IndexOptions {
    const partial = options.partialFilterExpression;
    if (partial !== undefined) {
      for (const path of IndexHelpers.filterPaths(partial)) {
        if (SchemaCompiler.dbPathOrUndefined(path, paths, session) === undefined) {
          throw new ConfigurationError(`${where}: partialFilterExpression "${path}" is not a field of the class`);
        }
      }
    }
    if (options.partialFilterExpression !== undefined && options.sparse === true) {
      throw new ConfigurationError(`${where}: "sparse" and "partialFilterExpression" cannot be combined (server rule)`);
    }
    const weights = options.weights;
    if (weights !== undefined) {
      for (const path of Object.keys(weights)) {
        if (SchemaCompiler.dbPathOrUndefined(path, paths, session) === undefined) {
          throw new ConfigurationError(`${where}: weights."${path}" is not a field of the class`);
        }
      }
    }
    return Object.freeze({
      ...options,
      ...(partial === undefined ? {} : { partialFilterExpression: IndexHelpers.mapFilter(partial, toDb) }),
      ...(weights === undefined
        ? {}
        : { weights: Object.fromEntries(Object.entries(weights).map(([path, weight]) => [toDb(path), weight])) }),
    });
  }

  /**
   * Checks that a TTL index is a single-field index on a `Date` field.
   *
   * @param where - The index, for messages.
   * @param keys - The indexed paths.
   * @param paths - The paths of the schema.
   * @param session - The compile session.
   * @throws {ConfigurationError} When the index is not a single-field index on a Date field.
   */
  private static checkTtl(
    where: string,
    keys: readonly string[],
    paths: Readonly<Record<string, PathNode>>,
    session: CompileSession,
  ): void {
    const [key] = keys;
    const node = key === undefined ? undefined : SchemaCompiler.nodeOf(key, paths, session);
    const isDate =
      node !== undefined &&
      (node.kind === "scalar"
        ? node.type === "date"
        : node.kind === "array" && node.element.kind === "scalar" && node.element.type === "date");
    if (keys.length !== 1 || !isDate) {
      throw new ConfigurationError(`${where}: expireAfterSeconds (TTL) needs a single-field index on a Date field`);
    }
  }

  /**
   * Deduplicates equal indexes and refuses conflicting ones.
   *
   * @param target - The class.
   * @param indexes - The collected indexes.
   * @param options - The schema options.
   * @returns The frozen distinct indexes.
   * @throws {ConfigurationError} When there are several text indexes, two indexes conflict, or a time series
   * collection has a unique index.
   */
  private static checkIndexes(
    target: ClassRef,
    indexes: readonly CompiledIndex[],
    options: SchemaOptions,
  ): readonly CompiledIndex[] {
    const out: CompiledIndex[] = [];
    const texts = indexes.filter((index) => IndexHelpers.isText(index.keys));
    if (texts.length > 1) {
      throw new ConfigurationError(
        `${target.name}: a collection has at most one text index; "text: true" fields are merged into one, so remove the extra @Index text (found ${texts.map((index) => IndexHelpers.nameOf(index)).join(", ")})`,
      );
    }
    for (const index of indexes) {
      const name = IndexHelpers.nameOf(index);
      const same = out.find(
        (existing) => IndexHelpers.nameOf(existing) === name || IndexHelpers.sameKeys(existing.keys, index.keys),
      );
      if (same === undefined) {
        out.push(index);
        continue;
      }
      if (
        IndexHelpers.sameKeys(same.keys, index.keys) &&
        JSON.stringify(same.options) === JSON.stringify(index.options)
      )
        continue;
      throw new ConfigurationError(`${target.name}: two indexes named or keyed "${name}" with different definitions`);
    }
    if (options.timeseries !== undefined && out.some((index) => index.options.unique === true)) {
      throw new ConfigurationError(`${target.name}: a time series collection cannot have unique indexes`);
    }
    return Object.freeze(out);
  }

  /**
   * The node of a code path of the schema being compiled (through compiled subdocuments).
   *
   * @param path - The code path.
   * @param paths - The paths of the schema.
   * @param session - The compile session.
   * @returns The node; `undefined` when the path is not a field.
   */
  private static nodeOf(
    path: string,
    paths: Readonly<Record<string, PathNode>>,
    session: CompileSession,
  ): PathNode | undefined {
    const direct = paths[path];
    if (direct !== undefined) return direct;
    const segments = path.split(".");
    for (let cut = segments.length - 1; cut > 0; cut--) {
      const head = segments.slice(0, cut).join(".");
      let node = paths[head];
      while (node !== undefined && node.kind === "array") node = node.element;
      if (node === undefined) continue;
      if (node.kind === "subdocument" && !session.inProgress.has(node.target)) {
        return node.schema.resolve(segments.slice(cut).join("."));
      }
      if (node.kind === "map") return node.value;
      return undefined;
    }
    return undefined;
  }

  /**
   * The database path of a code path of the schema being compiled.
   *
   * @param path - The code path.
   * @param paths - The paths of the schema.
   * @param session - The compile session.
   * @returns The database path; `undefined` when the path is not a field.
   */
  private static dbPathOrUndefined(
    path: string,
    paths: Readonly<Record<string, PathNode>>,
    session: CompileSession,
  ): string | undefined {
    const direct = paths[path];
    if (direct !== undefined) return direct.dbPath;
    const segments = path.split(".");
    for (let cut = segments.length - 1; cut > 0; cut--) {
      const head = segments.slice(0, cut).join(".");
      const node = paths[head];
      if (node === undefined) continue;
      let inner: PathNode = node;
      while (inner.kind === "array") inner = inner.element;
      if (inner.kind === "subdocument" && !session.inProgress.has(inner.target)) {
        const rest = inner.schema.toDbPath(segments.slice(cut).join("."));
        return rest === undefined ? undefined : `${node.dbPath}.${rest}`;
      }
      if (inner.kind === "map") return `${node.dbPath}.${segments.slice(cut).join(".")}`;
      return undefined;
    }
    return undefined;
  }

  /**
   * The database path of a code path of the schema being compiled.
   *
   * @param target - The class.
   * @param path - The code path.
   * @param paths - The paths of the schema.
   * @param session - The compile session.
   * @returns The database path.
   * @throws {ConfigurationError} When the path is not a field of the class.
   */
  private static dbPathOf(
    target: ClassRef,
    path: string,
    paths: Readonly<Record<string, PathNode>>,
    session: CompileSession,
  ): string {
    const db = SchemaCompiler.dbPathOrUndefined(path, paths, session);
    if (db === undefined) throw new ConfigurationError(`${target.name}: "${path}" is not a field of the class`);
    return db;
  }

  /**
   * The virtuals of a class: populate virtuals (checked against the referenced class) and native getters.
   *
   * @param target - The class.
   * @param record - The class record.
   * @param paths - The paths of the schema.
   * @param fieldKeys - The keys of the fields.
   * @returns The frozen virtual definitions.
   * @throws {ConfigurationError} When a virtual clashes with a field or names a path that does not exist.
   */
  private static virtuals(
    target: ClassRef,
    record: ClassRecord,
    paths: Readonly<Record<string, PathNode>>,
    fieldKeys: readonly string[],
  ): readonly VirtualDefinition[] {
    const out: VirtualDefinition[] = [];
    for (const virtual of record.virtuals) {
      const where = `${target.name}: @Virtual "${virtual.key}"`;
      if (fieldKeys.includes(virtual.key)) throw new ConfigurationError(`${where} is also a @Prop field`);
      const { localField, foreignField, match } = virtual.options;
      if (typeof localField !== "string" || paths[localField] === undefined) {
        throw new ConfigurationError(`${where}: localField "${String(localField)}" is not a field of the class`);
      }
      const refTarget = SchemaCompiler.callVirtualRef(virtual.options.ref, where);
      const foreignKeys = new Set(MetadataStore.merged(refTarget).fields.map((field) => field.key));
      const topOf = (path: string): string => path.split(".")[0] ?? path;
      if (
        typeof foreignField !== "string" ||
        (!foreignKeys.has(topOf(foreignField)) && topOf(foreignField) !== "_id")
      ) {
        throw new ConfigurationError(
          `${where}: foreignField "${String(foreignField)}" is not a field of ${refTarget.name}`,
        );
      }
      for (const key of Object.keys(match ?? {})) {
        if (!key.startsWith("$") && !foreignKeys.has(topOf(key))) {
          throw new ConfigurationError(`${where}: match."${key}" is not a field of ${refTarget.name}`);
        }
      }
      out.push(Object.freeze({ kind: "populate", key: virtual.key, options: virtual.options }));
    }
    for (const accessor of BuildChecks.accessors(target)) {
      out.push(Object.freeze({ kind: "getter", key: accessor.key, settable: accessor.settable }));
    }
    return Object.freeze(out);
  }

  /**
   * Calls the `ref` thunk of a populate virtual.
   *
   * @param ref - The thunk.
   * @param where - The virtual, for messages.
   * @returns The referenced schema class.
   * @throws {ConfigurationError} When the thunk throws or does not return a `@Schema` class.
   */
  private static callVirtualRef(ref: () => unknown, where: string): ClassRef {
    let target: unknown;
    try {
      target = ref();
    } catch (error) {
      throw new ConfigurationError(`${where}: "ref" threw`, { cause: error });
    }
    if (typeof target !== "function" || !MetadataStore.isSchema(target as ClassRef)) {
      throw new ConfigurationError(`${where}: "ref" must return a @Schema class`);
    }
    return target as ClassRef;
  }

  /**
   * The hook table: the hooks by event and phase, in run order.
   *
   * @param records - The hook records, base class first.
   * @returns The frozen table.
   */
  private static hooks(records: readonly HookRecord[]): HookTable {
    const table = Object.fromEntries(
      HOOK_EVENTS.map((event) => [
        event,
        { pre: [] as HookFunction[], post: [] as HookFunction[], postError: [] as HookFunction[] },
      ]),
    ) as Record<HookEvent, Record<HookPhase, HookFunction[]>>;
    /* Base class first, then subclasses (merged order); plugin hooks after the class's own (Mongoose
       applies global plugins at model() time, after the schema's hooks). */
    const ordered = [
      ...records.filter((hook) => hook.plugin === undefined),
      ...records.filter((hook) => hook.plugin !== undefined),
    ];
    for (const hook of ordered) for (const event of hook.events) table[event][hook.phase].push(hook.fn);
    return Object.freeze(
      Object.fromEntries(
        Object.entries(table).map(([event, phases]) => [
          event,
          Object.freeze({
            pre: Object.freeze(phases.pre),
            post: Object.freeze(phases.post),
            postError: Object.freeze(phases.postError),
          }),
        ]),
      ),
    ) as HookTable;
  }

  /**
   * Checks that the fields the tenant and soft delete policies use exist, with the right type, and that the
   * tenant field is marked `@Tenant()` — the run-time twin of the `TenantField<T>` type, so a schema built without
   * the types (JavaScript, a plugin) is checked the same way.
   *
   * @param target - The class.
   * @param options - The schema options (with the policies plugins enabled).
   * @param paths - The paths of the schema.
   * @param tenantFields - The fields marked `@Tenant()` along the class chain.
   * @throws {ConfigurationError} When the tenant field is missing or not marked `@Tenant()`, when `@Tenant()` marks
   * another field or a schema without the tenant policy, or when the soft delete field is not a nullable Date.
   */
  private static checkPolicies(
    target: ClassRef,
    options: SchemaOptions,
    paths: Readonly<Record<string, PathNode>>,
    tenantFields: readonly string[],
  ): void {
    const fieldOf = (option: true | { readonly field?: string } | undefined, fallback: string): string | undefined =>
      option === undefined ? undefined : option === true ? fallback : (option.field ?? fallback);
    const tenant = fieldOf(options.tenant, "tenantId");
    if (tenant !== undefined && paths[tenant] === undefined) {
      throw new ConfigurationError(`${target.name}: tenant field "${tenant}" is not a field of the class`);
    }
    const marked = tenantFields.map((key) => `"${key}"`).join(", ");
    if (tenant === undefined && tenantFields.length > 0) {
      throw new ConfigurationError(
        `${target.name}: @Tenant() on ${marked}, but the schema has no tenant policy — add tenant: true (or { field }) to @Schema`,
      );
    }
    if (tenant !== undefined && !tenantFields.includes(tenant)) {
      throw new ConfigurationError(
        `${target.name}: the tenant field "${tenant}" must be marked @Tenant() (declare it @Prop(...) @Tenant() ${tenant}!: TenantField<T>)`,
      );
    }
    if (tenant !== undefined && tenantFields.length > 1) {
      throw new ConfigurationError(
        `${target.name}: @Tenant() marks ${marked}; only the tenant field "${tenant}" may be marked`,
      );
    }
    const softDelete = fieldOf(options.softDelete, "deletedAt");
    if (softDelete !== undefined) {
      const node = paths[softDelete];
      if (node === undefined || node.kind !== "scalar" || node.type !== "date" || !node.nullable) {
        throw new ConfigurationError(
          `${target.name}: softDelete field "${softDelete}" must be a nullable Date field (Date | null)`,
        );
      }
    }
  }

  /**
   * Refuses collection options the server would refuse or silently ignore: capped sizes, clustered with
   * capped/time series, a clustered TTL without a `Date` `_id`, time series numbers.
   *
   * @param target - The class.
   * @param options - The schema options.
   * @param paths - The paths of the schema.
   * @param indexes - The compiled indexes.
   * @throws {ConfigurationError} When an option is invalid or combined with an option it cannot be used with.
   */
  private static checkCollectionOptions(
    target: ClassRef,
    options: SchemaOptions,
    paths: Readonly<Record<string, PathNode>>,
    indexes: readonly CompiledIndex[],
  ): void {
    /* The server refuses a text or 2d index with a collation ("Index type 'text' does not support
       collation"), and an index without one takes the collection's default: such an index must say
       `collation: { locale: "simple" }` itself. Mongoose dropped the collation silently (gh-10044). */
    const collated = options.collation !== undefined && options.collation.locale !== "simple";
    for (const index of indexes) {
      const kinds = Object.values(index.keys);
      if (!kinds.includes("text") && !kinds.includes("2d")) continue;
      const own = index.options.collation;
      if ((own !== undefined && own.locale !== "simple") || (own === undefined && collated)) {
        throw new ConfigurationError(
          `${target.name}: a ${kinds.includes("text") ? "text" : "2d"} index cannot have a collation; ` +
            (own === undefined
              ? `the collection has a default one, so declare the index with collation: { locale: "simple" }`
              : "remove the collation of the index"),
        );
      }
    }
    const positive = (value: number | undefined, what: string): void => {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
        throw new ConfigurationError(`${target.name}: ${what} must be a positive integer, got ${value}`);
    };
    const nonNegative = (value: number | undefined, what: string): void => {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
        throw new ConfigurationError(`${target.name}: ${what} must be a non-negative integer, got ${value}`);
    };
    positive(options.capped?.size, "capped.size");
    positive(options.capped?.max, "capped.max");
    const series = options.timeseries;
    nonNegative(series?.expireAfterSeconds, "timeseries.expireAfterSeconds");
    positive(series?.bucketMaxSpanSeconds, "timeseries.bucketMaxSpanSeconds");
    positive(series?.bucketRoundingSeconds, "timeseries.bucketRoundingSeconds");
    if (series !== undefined && series.bucketMaxSpanSeconds !== series.bucketRoundingSeconds)
      /* The server (8.3, 9.0) requires both, equal: "bucketRoundingSeconds must be equal to bucketMaxSpanSeconds". */
      throw new ConfigurationError(
        `${target.name}: timeseries.bucketMaxSpanSeconds and bucketRoundingSeconds must both be set and equal (the server requires it)`,
      );
    if (series?.bucketMaxSpanSeconds !== undefined && series.granularity !== undefined)
      throw new ConfigurationError(
        `${target.name}: timeseries.granularity cannot be combined with bucketMaxSpanSeconds/bucketRoundingSeconds`,
      );
    const clustered = options.clustered;
    if (clustered === undefined) return;
    if (options.capped !== undefined)
      throw new ConfigurationError(`${target.name}: a clustered collection cannot be capped`);
    if (series !== undefined)
      throw new ConfigurationError(`${target.name}: a time series collection is clustered by itself; remove clustered`);
    if (clustered !== true) {
      nonNegative(clustered.expireAfterSeconds, "clustered.expireAfterSeconds");
      const id = paths._id;
      if (
        clustered.expireAfterSeconds !== undefined &&
        (id === undefined || id.kind !== "scalar" || id.type !== "date")
      )
        /* The server only expires documents whose _id is a date: with another _id the TTL would never apply. */
        throw new ConfigurationError(`${target.name}: clustered.expireAfterSeconds needs a Date _id`);
    }
  }

  /**
   * Checks the time series options against the fields.
   *
   * @param target - The class.
   * @param options - The schema options.
   * @param paths - The paths of the schema.
   * @throws {ConfigurationError} When the time field or meta field is missing or has the wrong type, or the
   * collection is also capped.
   */
  private static checkTimeSeries(
    target: ClassRef,
    options: SchemaOptions,
    paths: Readonly<Record<string, PathNode>>,
  ): void {
    const series = options.timeseries;
    if (series === undefined) return;
    const where = `${target.name}: timeseries`;
    if (options.capped !== undefined)
      throw new ConfigurationError(`${where}: a time series collection cannot be capped`);
    const time = paths[series.timeField];
    if (time === undefined || time.kind !== "scalar" || time.type !== "date" || time.nullable) {
      throw new ConfigurationError(`${where}: timeField "${series.timeField}" must be a non-nullable Date field`);
    }
    if (!time.required)
      throw new ConfigurationError(
        `${where}: timeField "${series.timeField}" must be required (every measurement has it)`,
      );
    if (series.metaField !== undefined) {
      if (
        series.metaField === "_id" ||
        series.metaField === series.timeField ||
        paths[series.metaField] === undefined
      ) {
        throw new ConfigurationError(
          `${where}: metaField "${series.metaField}" must be a field of the class other than _id and the time field`,
        );
      }
    }
  }
}
