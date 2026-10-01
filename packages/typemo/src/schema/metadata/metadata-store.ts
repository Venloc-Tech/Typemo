import { defineMetadata, getOwnMetadata } from "reflect-metadata/no-conflict";
import { ConfigurationError } from "../../errors/configuration-error.ts";
import type {
  ClassRecord,
  ClassRef,
  FieldRecord,
  HookRecord,
  IndexRecord,
  PluginRecord,
  SearchIndexRecord,
  VirtualRecord,
} from "./metadata-types.ts";

/** The metadata key of a class record. */
const RECORD_KEY = Symbol("typemo:class-record");
/** The metadata key of a class's registered discriminators. */
const DISCRIMINATORS_KEY = Symbol("typemo:discriminators");

/** The record of a class with no decorators. */
const EMPTY_RECORD: ClassRecord = Object.freeze({
  schema: undefined,
  fields: Object.freeze([]),
  indexes: Object.freeze([]),
  searchIndexes: Object.freeze([]),
  virtuals: Object.freeze([]),
  hooks: Object.freeze([]),
  plugins: Object.freeze([]),
  discriminator: undefined,
  tenantFields: Object.freeze([]),
});

/**
 * The metadata of a class and all its ancestors, base first (fields keep the most derived declaration).
 *
 * @example
 * ```ts
 * const merged: MergedMetadata = MetadataStore.merged(User);
 * merged.fields.map((field) => field.key);
 * ```
 */
export interface MergedMetadata {
  /** The class the metadata was merged for. */
  readonly target: ClassRef;
  /** The class and its ancestors that carry metadata, base first. */
  readonly chain: readonly ClassRef[];
  /**
   * One record per key: a redeclared field keeps the subclass record (`overridden` has the base one).
   * Class-level lists are in source order.
   */
  readonly fields: readonly FieldRecord[];
  /** Base declarations replaced by a subclass declaration of the same key. */
  readonly overridden: readonly FieldRecord[];
  /** The index records of the whole chain. */
  readonly indexes: readonly IndexRecord[];
  /** The search index records of the whole chain. */
  readonly searchIndexes: readonly SearchIndexRecord[];
  /** The virtual records of the whole chain. */
  readonly virtuals: readonly VirtualRecord[];
  /** The hook records of the whole chain. */
  readonly hooks: readonly HookRecord[];
  /** The plugin records of the whole chain. */
  readonly plugins: readonly PluginRecord[];
  /** The fields marked `@Tenant()` along the chain (each once). */
  readonly tenantFields: readonly string[];
}

/**
 * Who wrote a class record: a decorator package, or the core itself (the base classes `Entity`, …).
 *
 * @example
 * ```ts
 * const origin: MetadataOrigin = "legacy";
 * ```
 */
export type MetadataOrigin = "legacy" | "tc39" | "core";

/**
 * Per-class metadata records with inheritance merge, stored with `reflect-metadata` on the constructor. The
 * `no-conflict` entry is used: it stores metadata in the registry shared with a global
 * `import "reflect-metadata"` (Nest and friends interoperate) but does not replace the global `Reflect.*`
 * functions — no global patching, and nothing depends on `emitDecoratorMetadata`: Typemo never reads
 * `design:type`.
 *
 * Writes are copy-on-write; once the compiler has compiled a class it is sealed, and any later write to it (a
 * late decorator, a discriminator registered after its base was compiled) is a `ConfigurationError` instead of
 * a silently stale schema.
 */
export class MetadataStore {
  /** The classes whose schema is compiled. */
  private static readonly sealed = new WeakSet<ClassRef>();
  /**
   * Metadata sources: a decorator package whose metadata does not live in this store (TC39
   * `Symbol.metadata`) registers a loader; it runs once per class, before its record is first read, and writes
   * through `MetadataBuilder`. With no source registered the read path is unchanged.
   */
  private static readonly sources: Array<(target: ClassRef) => void> = [];
  /** The classes whose sources have run. */
  private static readonly loaded = new WeakSet<ClassRef>();
  /** Which decorator package wrote each class: a hierarchy written by both is refused at compile. */
  private static readonly origins = new WeakMap<ClassRef, Set<MetadataOrigin>>();

  /**
   * Records that `origin` wrote metadata of `target`.
   *
   * @param target - The class.
   * @param origin - The writer.
   */
  static markOrigin(target: ClassRef, origin: MetadataOrigin): void {
    const origins = MetadataStore.origins.get(target) ?? new Set<MetadataOrigin>();
    origins.add(origin);
    MetadataStore.origins.set(target, origins);
  }

  /**
   * Refuses legacy and TC39 metadata in one class hierarchy.
   *
   * @param target - The class whose hierarchy is checked.
   * @throws {ConfigurationError} When both decorator packages wrote metadata in the hierarchy.
   */
  static assertSingleOrigin(target: ClassRef): void {
    const seen = new Map<MetadataOrigin, ClassRef>();
    for (const current of MetadataStore.chain(target)) {
      for (const origin of MetadataStore.origins.get(current) ?? []) if (!seen.has(origin)) seen.set(origin, current);
    }
    const legacy = seen.get("legacy");
    const tc39 = seen.get("tc39");
    if (legacy !== undefined && tc39 !== undefined) {
      throw new ConfigurationError(
        `${target.name}: mixes legacy decorators ("@venloc/typemo", on ${legacy.name}) and TC39 decorators ("@venloc/typemo-decorators", on ${tc39.name}) in one class hierarchy; use one decorator package per project`,
      );
    }
  }

  /**
   * Registers a metadata source: `load(target)` runs once per class before its record is first read.
   *
   * @param load - The loader.
   */
  static addSource(load: (target: ClassRef) => void): void {
    if (!MetadataStore.sources.includes(load)) MetadataStore.sources.push(load);
  }

  /**
   * The record of this class only (not inherited).
   *
   * @param target - The class.
   * @returns The class record; an empty one for a class without decorators.
   */
  static own(target: ClassRef): ClassRecord {
    if (MetadataStore.sources.length > 0 && !MetadataStore.loaded.has(target)) {
      MetadataStore.loaded.add(target);
      for (const load of MetadataStore.sources) load(target);
    }
    return (getOwnMetadata(RECORD_KEY, target) as ClassRecord | undefined) ?? EMPTY_RECORD;
  }

  /**
   * Replaces the record of `target` with `update(current)`, frozen.
   *
   * @param target - The class.
   * @param update - Returns the new record from the current one.
   * @throws {ConfigurationError} When the class is already compiled.
   */
  static write(target: ClassRef, update: (current: ClassRecord) => ClassRecord): void {
    MetadataStore.assertWritable(target);
    defineMetadata(RECORD_KEY, Object.freeze(update(MetadataStore.own(target))), target);
  }

  /**
   * Whether the class itself has a `@Schema` or a `@Discriminator` (inheritance alone does not make a schema).
   *
   * @param target - The class.
   * @returns `true` for a schema class.
   */
  static isSchema(target: ClassRef): boolean {
    const own = MetadataStore.own(target);
    return own.schema !== undefined || own.discriminator !== undefined;
  }

  /**
   * The class and its ancestors up to (not including) `Object`, base first.
   *
   * @param target - The class.
   * @returns The chain.
   */
  static chain(target: ClassRef): ClassRef[] {
    const chain: ClassRef[] = [];
    for (let current: unknown = target; typeof current === "function" && current !== Function.prototype; ) {
      chain.unshift(current as ClassRef);
      current = Object.getPrototypeOf(current);
    }
    return chain;
  }

  /**
   * The parent class.
   *
   * @param target - The class.
   * @returns The parent, `undefined` for a root class.
   */
  static parentOf(target: ClassRef): ClassRef | undefined {
    const parent: unknown = Object.getPrototypeOf(target);
    return typeof parent === "function" && parent !== Function.prototype ? (parent as ClassRef) : undefined;
  }

  /**
   * Metadata of the class merged along its inheritance chain.
   *
   * @param target - The class.
   * @returns The merged metadata.
   * @throws {ConfigurationError} When the hierarchy mixes legacy and TC39 decorators.
   */
  static merged(target: ClassRef): MergedMetadata {
    MetadataStore.assertSingleOrigin(target);
    const chain = MetadataStore.chain(target);
    const records = chain.map(MetadataStore.own);
    const byKey = new Map<string, FieldRecord>();
    const overridden: FieldRecord[] = [];
    for (const record of records) {
      for (const field of record.fields) {
        const previous = byKey.get(field.key);
        if (previous !== undefined && previous.owner !== field.owner) overridden.push(previous);
        byKey.set(field.key, field);
      }
    }
    return Object.freeze({
      target,
      chain: Object.freeze(chain.filter((_, index) => records[index] !== EMPTY_RECORD)),
      fields: Object.freeze([...byKey.values()]),
      overridden: Object.freeze(overridden),
      /* Class decorators run bottom-up; source order (top to bottom) is restored per class. */
      indexes: Object.freeze(records.flatMap((record) => [...record.indexes].reverse())),
      searchIndexes: Object.freeze(records.flatMap((record) => [...record.searchIndexes].reverse())),
      virtuals: Object.freeze(records.flatMap((record) => record.virtuals)),
      hooks: Object.freeze(records.flatMap((record) => record.hooks)),
      plugins: Object.freeze(records.flatMap((record) => [...record.plugins].reverse())),
      tenantFields: Object.freeze([...new Set(records.flatMap((record) => record.tenantFields))]),
    });
  }

  /**
   * Registers `child` as a discriminator of its direct parent (the compiler walks the tree from the root).
   *
   * @param parent - The parent class.
   * @param child - The discriminator class.
   * @throws {ConfigurationError} When the parent is already compiled.
   */
  static registerDiscriminator(parent: ClassRef, child: ClassRef): void {
    MetadataStore.assertWritable(parent);
    const current = MetadataStore.discriminatorsOf(parent);
    defineMetadata(DISCRIMINATORS_KEY, Object.freeze([...current, child]), parent);
  }

  /**
   * The classes registered as discriminators of `parent` (direct children only), in registration order.
   *
   * @param parent - The parent class.
   * @returns The discriminator classes.
   */
  static discriminatorsOf(parent: ClassRef): readonly ClassRef[] {
    return (getOwnMetadata(DISCRIMINATORS_KEY, parent) as readonly ClassRef[] | undefined) ?? [];
  }

  /**
   * Marks a class as compiled: its metadata may no longer change.
   *
   * @param target - The class.
   */
  static seal(target: ClassRef): void {
    MetadataStore.sealed.add(target);
  }

  /**
   * Whether a class is compiled.
   *
   * @param target - The class.
   * @returns `true` when its metadata is sealed.
   */
  static isSealed(target: ClassRef): boolean {
    return MetadataStore.sealed.has(target);
  }

  /**
   * Refuses a write to a compiled class.
   *
   * @param target - The class.
   * @throws {ConfigurationError} When the class is compiled.
   */
  private static assertWritable(target: ClassRef): void {
    if (MetadataStore.sealed.has(target)) {
      throw new ConfigurationError(
        `${target.name}: its schema is already compiled; decorators, plugins and discriminators must be declared before the first use of the class`,
      );
    }
  }
}
