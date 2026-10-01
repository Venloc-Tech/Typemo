import type { HookEvent, HookPhase } from "../../hooks/hook-events.ts";
import { SensitiveMask, type SensitivePath } from "../../policies/sensitive-mask.ts";
import type { ClassRef, HookFunction, StaticFunction } from "../metadata/metadata-types.ts";
import type { IndexDirection, IndexOptions, SearchIndexOptions } from "../options/index-options.ts";
import type { SchemaOptions } from "../options/schema-options.ts";
import type { VirtualOptions } from "../options/virtual-options.ts";
import type { PathNode } from "./path-node.ts";

/**
 * Where a discriminator schema sits in its hierarchy.
 *
 * @example
 * ```ts
 * class Animal extends Entity {}
 * const info: DiscriminatorInfo = { root: Animal, key: "__t", value: "dog" };
 * ```
 */
export interface DiscriminatorInfo {
  /** The root class (the first ancestor that is not a discriminator). */
  readonly root: ClassRef;
  /** The discriminator key (default `__t`). */
  readonly key: string;
  /** The value that selects this class. */
  readonly value: string;
}

/**
 * A virtual of the class: a populate virtual (`@Virtual`) or a native getter/accessor.
 *
 * @example
 * ```ts
 * const getter: VirtualDefinition = { kind: "getter", key: "fullName", settable: false };
 * ```
 */
export type VirtualDefinition =
  | { readonly kind: "populate"; readonly key: string; readonly options: VirtualOptions }
  | { readonly kind: "getter"; readonly key: string; readonly settable: boolean };

/**
 * An index to create (database paths).
 *
 * @example
 * ```ts
 * const index: CompiledIndex = { keys: { email: 1 }, options: { unique: true }, source: "field", owner: User };
 * ```
 */
export interface CompiledIndex {
  /** The indexed database paths with their directions. */
  readonly keys: Readonly<Record<string, IndexDirection>>;
  /** The index options. */
  readonly options: IndexOptions;
  /** Where it comes from: a field option, `@Index`, merged `text: true` fields, or a discriminator. */
  readonly source: "field" | "class" | "text";
  /** The class that declared it. */
  readonly owner: ClassRef;
}

/**
 * Hooks by event and phase, in run order.
 *
 * @example
 * ```ts
 * declare const hooks: HookTable;
 * const saveHooks = hooks["document.save"].pre; // in run order
 * ```
 */
export type HookTable = Readonly<Record<HookEvent, Readonly<Record<HookPhase, readonly HookFunction[]>>>>;

/**
 * Plain JSON description of a compiled schema, for snapshots and debugging.
 *
 * @example
 * ```ts
 * const description: SchemaDescription = Users.schema.describe();
 * ```
 */
export interface SchemaDescription {
  /** The class name. */
  readonly name: string;
  /** Whether the schema is a document or a nested object. */
  readonly kind: "document" | "nested";
  /** The collection name. */
  readonly collection: string;
  /** The discriminator info, when the schema is a discriminator. */
  readonly discriminator: DiscriminatorInfoDescription | undefined;
  /** The discriminator values of the hierarchy. */
  readonly discriminators: readonly string[];
  /** The paths of the whole tree by canonical code path. */
  readonly paths: Readonly<Record<string, PathDescription>>;
  /** The indexes with their keys and options. */
  readonly indexes: readonly {
    readonly keys: Readonly<Record<string, IndexDirection>>;
    readonly options: IndexOptions;
  }[];
  /** The search and vector search indexes (`@SearchIndex`), top to bottom as written; empty when there are none. */
  readonly searchIndexes: readonly SearchIndexOptions[];
  /** The virtuals as `kind:key`. */
  readonly virtuals: readonly string[];
  /** The number of hooks by `phase event`. */
  readonly hooks: Readonly<Record<string, number>>;
  /** Schema-level extension options, when there are any. */
  readonly ext?: Readonly<Record<string, unknown>>;
}

/**
 * JSON of a discriminator info.
 *
 * @example
 * ```ts
 * const info: DiscriminatorInfoDescription = { root: "Animal", key: "__t", value: "dog" };
 * ```
 */
export interface DiscriminatorInfoDescription {
  /** The root class name. */
  readonly root: string;
  /** The discriminator key. */
  readonly key: string;
  /** The value that selects the class. */
  readonly value: string;
}

/**
 * JSON of one path.
 *
 * @example
 * ```ts
 * const path: PathDescription = { kind: "scalar", type: "string", flags: "required" };
 * ```
 */
export interface PathDescription {
  /** The node kind. */
  readonly kind: string;
  /** The scalar type, union members or subdocument schema name. */
  readonly type?: string;
  /** The database path, when it differs from the code path. */
  readonly dbPath?: string;
  /** Comma-separated flags (`required`, `nullable`, …). */
  readonly flags?: string;
  /** Field-level extension options, when there are any. */
  readonly ext?: Readonly<Record<string, unknown>>;
}

/**
 * Everything the compiler hands to a `CompiledSchema`.
 *
 * @example
 * ```ts
 * const schema = new CompiledSchema(init);
 * ```
 */
export interface CompiledSchemaInit {
  /** The schema class. */
  readonly target: ClassRef;
  /** Whether the schema is a document or a nested object. */
  readonly kind: "document" | "nested";
  /** The `@Schema` options. */
  readonly options: SchemaOptions;
  /** The collection name. */
  readonly collection: string;
  /** Top-level fields in declaration order. */
  readonly fields: readonly PathNode[];
  /** Paths by canonical code path. */
  readonly paths: Readonly<Record<string, PathNode>>;
  /** The indexes to create. */
  readonly indexes: readonly CompiledIndex[];
  /** The search indexes to create. */
  readonly searchIndexes: readonly SearchIndexOptions[];
  /** The virtuals of the class. */
  readonly virtuals: readonly VirtualDefinition[];
  /** The hooks by event and phase. */
  readonly hooks: HookTable;
  /** Statics added by plugins (name → function; `this` = the model). */
  readonly statics: ReadonlyMap<string, StaticFunction>;
  /** The names of the plugins applied to this schema, in order. */
  readonly plugins: readonly string[];
  /** The discriminator info, when the schema is a discriminator. */
  readonly discriminator: DiscriminatorInfo | undefined;
  /** The discriminator key of the hierarchy. */
  readonly discriminatorKey: string;
  /** Resolves the discriminator schemas of the root (lazy: they are compiled with the root). */
  readonly discriminators: () => ReadonlyMap<string, CompiledSchema>;
  /** The root schema of a discriminator (lazy), the schema itself for a root. */
  readonly root: () => CompiledSchema;
}

/** The extension options of a schema or path without any. */
const EMPTY_EXT: Readonly<Record<string, unknown>> = Object.freeze({});

/** Matches a path segment that stands for an array element: an index, `$`, `$[]` or `$[identifier]`. */
const ARRAY_INDEX = /^(?:\d+|\$|\$\[\]|\$\[[A-Za-z][A-Za-z0-9_]*\])$/;

/**
 * The read-only view of a compiled schema for integrations and extensions: what they may read, nothing of the
 * compiler's internals.
 *
 * @example
 * ```ts
 * const info: SchemaInfo = Users.schema;
 * info.toDbPath("address.city");
 * ```
 */
export interface SchemaInfo {
  /** The class name. */
  readonly name: string;
  /** Collection name (meaningful for root documents). */
  readonly collection: string;
  /**
   * The whole description of the paths.
   *
   * @returns The plain description.
   */
  describe(): SchemaDescription;
  /** Options of registered extensions on the schema (`ext`). */
  readonly ext: Readonly<Record<string, unknown>>;
  /**
   * Options of registered extensions on a path.
   *
   * @param path - The path in any positional form.
   * @returns The `ext` options; `undefined` when the path does not exist.
   */
  extOf(path: string): Readonly<Record<string, unknown>> | undefined;
  /**
   * The database form of a code path.
   *
   * @param path - The code path.
   * @returns The database path; `undefined` when the path does not exist.
   */
  toDbPath(path: string): string | undefined;
}

/**
 * The compiled schema of one class: an immutable tree of paths plus everything derived from the metadata
 * (indexes, hooks, virtuals, discriminators, collection name). All lookups are computed at compile time;
 * reading never mutates (Mongoose cached positional paths into `subpaths` on read and wrote `$fullPath` into
 * shared SchemaTypes).
 */
export class CompiledSchema implements SchemaInfo {
  /** The schema class. */
  readonly target: ClassRef;
  /** The class name. */
  readonly name: string;
  /** Whether the schema is a document or a nested object. */
  readonly kind: "document" | "nested";
  /** The `@Schema` options. */
  readonly options: Readonly<SchemaOptions>;
  /** Collection name (meaningful for root documents). */
  readonly collection: string;
  /** Top-level fields in declaration order (base class first). */
  readonly fields: readonly PathNode[];
  /**
   * Paths of this schema by canonical code path: fields, nested objects inlined (`name.first`), array
   * elements (`tags.$`) and map values (`scores.$*`). Paths inside subdocuments are in the
   * subdocument's schema; {@link allPaths} has the whole tree.
   */
  readonly paths: Readonly<Record<string, PathNode>>;
  /** The indexes to create. */
  readonly indexes: readonly CompiledIndex[];
  /** The search indexes to create. */
  readonly searchIndexes: readonly SearchIndexOptions[];
  /** The virtuals of the class. */
  readonly virtuals: readonly VirtualDefinition[];
  /** The hooks by event and phase, in run order. */
  readonly hooks: HookTable;
  /** Statics added by plugins: defined on every model of the schema. */
  readonly statics: ReadonlyMap<string, StaticFunction>;
  /** The names of the plugins applied to this schema (global → connection → model, deduplicated). */
  readonly plugins: readonly string[];
  /** Set on a discriminator schema. */
  readonly discriminator: DiscriminatorInfo | undefined;
  /** The discriminator key of the hierarchy (default `__t`). */
  readonly discriminatorKey: string;
  /** `true` when the class declares `_id`. */
  readonly hasId: boolean;
  /** Resolves the discriminator schemas of the root. */
  private readonly discriminatorsOf: () => ReadonlyMap<string, CompiledSchema>;
  /** Resolves the root schema. */
  private readonly rootOf: () => CompiledSchema;
  /** The whole-tree path index, set by {@link CompiledSchema.seal}. */
  private allPathsCache: Readonly<Record<string, PathNode>> | undefined;
  /** The `sensitive` mode map, set by {@link CompiledSchema.seal}. */
  private sensitiveCache: readonly SensitivePath[] | undefined;
  /** The top-level fields by property name. */
  private readonly fieldsByKey: Readonly<Record<string, PathNode>>;

  /**
   * @param init - Everything the compiler hands over.
   */
  constructor(init: CompiledSchemaInit) {
    this.target = init.target;
    this.name = init.target.name;
    this.kind = init.kind;
    this.options = init.options;
    this.collection = init.collection;
    this.fields = init.fields;
    this.paths = init.paths;
    this.indexes = init.indexes;
    this.searchIndexes = init.searchIndexes;
    this.virtuals = init.virtuals;
    this.hooks = init.hooks;
    this.statics = init.statics;
    this.plugins = init.plugins;
    this.discriminator = init.discriminator;
    this.discriminatorKey = init.discriminatorKey;
    this.discriminatorsOf = init.discriminators;
    this.rootOf = init.root;
    this.hasId = init.fields.some((field) => field.key === "_id");
    this.fieldsByKey = Object.freeze(
      Object.assign(Object.create(null) as Record<string, PathNode>, ...init.fields.map((f) => ({ [f.key]: f }))),
    );
  }

  /**
   * Computes the whole-tree path index and freezes the schema. Called by the compiler once every
   * schema of a compile unit exists (recursive schemas point to each other); never by readers.
   *
   * @param allPaths - The paths of the whole tree by canonical code path.
   */
  seal(allPaths: Readonly<Record<string, PathNode>>): void {
    if (Object.isFrozen(this)) return;
    this.allPathsCache = allPaths;
    /* The `sensitive` mode map (code and db paths): once per schema, at compile. */
    this.sensitiveCache = SensitiveMask.pathsOf(allPaths);
    Object.freeze(this);
  }

  /** Schema-level extension options (`@Schema({ ext })`): checked by their extensions and frozen. */
  get ext(): Readonly<Record<string, unknown>> {
    return (this.options.ext as Readonly<Record<string, unknown>> | undefined) ?? EMPTY_EXT;
  }

  /**
   * Field-level extension options (`@Prop({ ext })`) of a path in any form (`items.3.price`, code names),
   * through subdocuments, arrays and Maps.
   *
   * @param path - The path in any positional form.
   * @returns The `ext` options; `undefined` when the path does not exist.
   */
  extOf(path: string): Readonly<Record<string, unknown>> | undefined {
    const node = this.resolve(path);
    if (node === undefined) return undefined;
    return (node.options.ext as Readonly<Record<string, unknown>> | undefined) ?? EMPTY_EXT;
  }

  /** The `sensitive` mode map of this schema (marked and unmarked `Hidden` paths, code and db form). */
  get sensitivePaths(): readonly SensitivePath[] {
    return this.sensitiveCache ?? SensitiveMask.pathsOf(this.paths);
  }

  /**
   * Every path of the tree, through subdocuments, by canonical code path (recursive schemas: one level of
   * recursion).
   */
  get allPaths(): Readonly<Record<string, PathNode>> {
    return this.allPathsCache ?? this.paths;
  }

  /** The discriminator schemas of the hierarchy by value (the root's map, also from a discriminator). */
  get discriminators(): ReadonlyMap<string, CompiledSchema> {
    return this.discriminatorsOf();
  }

  /** The root schema of the hierarchy (itself when not a discriminator). */
  get root(): CompiledSchema {
    return this.rootOf();
  }

  /**
   * A top-level field by property name.
   *
   * @param key - The property name.
   * @returns The field node; `undefined` when there is none.
   */
  field(key: string): PathNode | undefined {
    return Object.hasOwn(this.fieldsByKey, key) ? this.fieldsByKey[key] : undefined;
  }

  /**
   * The schema for a discriminator value (by value, never by class name). The root for a value-less document is
   * the caller's decision.
   *
   * @param value - The discriminator value.
   * @returns The discriminator schema; `undefined` for an unknown value.
   */
  discriminatorFor(value: unknown): CompiledSchema | undefined {
    return typeof value === "string" ? this.discriminators.get(value) : undefined;
  }

  /**
   * The node of a path given in any positional form: `items.3.price`, `items.$.price`,
   * `items.$[].price`, `items.$[elem].price`, `scores.math`, `scores.$*` — or `undefined`. Walks
   * into subdocuments; the returned node carries its canonical full path when it is in {@link allPaths}.
   *
   * @param path - The path in any positional form.
   * @returns The node; `undefined` when the path does not exist.
   */
  resolve(path: string): PathNode | undefined {
    const canonical = this.canonicalPath(path);
    if (canonical === undefined) return undefined;
    return this.allPaths[canonical] ?? this.walk(canonical.split("."));
  }

  /**
   * The canonical code path (`items.$.price`) of a path in any positional form.
   *
   * @param path - The path in any positional form.
   * @returns The canonical path; `undefined` when the path does not exist.
   */
  canonicalPath(path: string): string | undefined {
    const segments = path.split(".");
    const out: string[] = [];
    let schema: CompiledSchema = this;
    let node: PathNode | undefined;
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index] as string;
      if (node === undefined) {
        node = schema.field(segment) ?? schema.paths[segment];
        if (node === undefined) return undefined;
        out.push(segment);
        continue;
      }
      switch (node.kind) {
        case "array":
          if (!ARRAY_INDEX.test(segment)) return undefined;
          node = node.element;
          out.push("$");
          break;
        case "map":
          node = node.value;
          out.push("$*");
          break;
        case "subdocument":
        case "nested":
          schema = node.schema;
          node = schema.field(segment);
          if (node === undefined) return undefined;
          out.push(segment);
          break;
        default:
          return undefined;
      }
    }
    return out.join(".");
  }

  /**
   * The database path of a code path (aliases applied).
   *
   * @param path - The code path.
   * @returns The database path; `undefined` when the path does not exist.
   */
  toDbPath(path: string): string | undefined {
    const segments = path.split(".");
    const canonical = this.canonicalPath(path);
    if (canonical === undefined) return undefined;
    const node = this.resolve(canonical);
    if (node === undefined) return undefined;
    /* Keep the caller's positional segments (`items.3`), take the names from the canonical db path. */
    const dbSegments = node.dbPath.split(".");
    return segments
      .map((segment, index) => (canonical.split(".")[index] === segment ? dbSegments[index] : segment))
      .join(".");
  }

  /**
   * Plain JSON for snapshots: paths with kind/type/flags, indexes, search indexes, virtuals, hook counts.
   *
   * @returns The description.
   */
  describe(): SchemaDescription {
    const paths: Record<string, PathDescription> = {};
    for (const [path, node] of Object.entries(this.allPaths)) {
      const flags = [
        node.required ? "required" : "",
        node.nullable ? "nullable" : "",
        node.immutable ? "immutable" : "",
        node.hidden ? "hidden" : "",
        node.defaultValue ? "default" : "",
        node.service ? `service:${node.service}` : "",
        node.ref ? "ref" : "",
      ]
        .filter((flag) => flag !== "")
        .join(",");
      paths[path] = {
        kind: node.kind,
        ...(node.kind === "scalar" ? { type: node.type } : {}),
        ...(node.kind === "union" ? { type: node.members.join("|") } : {}),
        ...(node.kind === "subdocument" || node.kind === "nested" ? { type: node.schema.name } : {}),
        ...(node.dbPath === path ? {} : { dbPath: node.dbPath }),
        ...(flags === "" ? {} : { flags }),
        ...(node.options.ext === undefined ? {} : { ext: node.options.ext as Readonly<Record<string, unknown>> }),
      };
    }
    const hooks: Record<string, number> = {};
    for (const [event, phases] of Object.entries(this.hooks)) {
      for (const [phase, list] of Object.entries(phases)) {
        if (list.length > 0) hooks[`${phase} ${event}`] = list.length;
      }
    }
    return {
      name: this.name,
      kind: this.kind,
      collection: this.collection,
      discriminator:
        this.discriminator === undefined
          ? undefined
          : { root: this.discriminator.root.name, key: this.discriminator.key, value: this.discriminator.value },
      discriminators: [...this.discriminators.keys()],
      paths,
      indexes: this.indexes.map((index) => ({ keys: index.keys, options: index.options })),
      searchIndexes: this.searchIndexes,
      virtuals: this.virtuals.map((virtual) => `${virtual.kind}:${virtual.key}`),
      hooks,
      ...(this.options.ext === undefined ? {} : { ext: this.ext }),
    };
  }

  /**
   * Walks canonical path segments through arrays, maps and subdocuments.
   *
   * @param segments - The canonical path segments.
   * @returns The node; `undefined` when the path does not exist.
   */
  private walk(segments: readonly string[]): PathNode | undefined {
    let schema: CompiledSchema = this;
    let node: PathNode | undefined;
    for (const segment of segments) {
      if (node === undefined) node = schema.field(segment) ?? schema.paths[segment];
      else if (node.kind === "array") node = node.element;
      else if (node.kind === "map") node = node.value;
      else if (node.kind === "subdocument" || node.kind === "nested") {
        schema = node.schema;
        node = schema.field(segment);
      } else return undefined;
      if (node === undefined) return undefined;
    }
    return node;
  }
}
