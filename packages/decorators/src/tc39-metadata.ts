import { ConfigurationError } from "@venloc/typemo";
import type {
  ClassRef,
  HookEvent,
  HookFunction,
  HookPhase,
  PropOptions,
  VirtualOptions,
} from "@venloc/typemo/adapters";
import { DecoratorGuard, MetadataBuilder, MetadataSources } from "@venloc/typemo/adapters";

/**
 * A member declaration recorded in `context.metadata` until the class is known.
 *
 * @example
 * ```ts
 * const entry: MemberEntry = { kind: "field", key: "name", type: () => String, options: {} };
 * ```
 */
type MemberEntry =
  | { readonly kind: "field"; readonly key: string; readonly type: () => unknown; readonly options: PropOptions<never> }
  | { readonly kind: "virtual"; readonly key: string; readonly options: VirtualOptions }
  | { readonly kind: "tenant"; readonly key: string }
  | {
      readonly kind: "hook";
      readonly key: string;
      readonly phase: HookPhase;
      readonly events: HookEvent | readonly HookEvent[];
      readonly fn: HookFunction;
    };

/**
 * A decorator context as far as this package reads it (field, method or class).
 *
 * @example
 * ```ts
 * const context: AnyContext = { kind: "field", name: "title", static: false, private: false, metadata: {} };
 * ```
 */
interface AnyContext {
  /** The decorated element kind: `field`, `method`, `class`, ... */
  readonly kind: string;
  /** The element name; `undefined` for anonymous classes. */
  readonly name: string | symbol | undefined;
  /** Whether the member is static. */
  readonly static?: boolean;
  /** Whether the member is `#private`. */
  readonly private?: boolean;
  /** The metadata object shared by all decorators of the class (see `DecoratorMetadata`: it may be `undefined` without `esnext.decorators`). */
  readonly metadata: DecoratorMetadata;
}

/*
 * Own key in the shared metadata object: the object of a subclass inherits the parent's through its
 * prototype, so entries are read with `Object.hasOwn` only.
 */
const ENTRIES = Symbol("typemo:tc39-entries");

/**
 * The bridge from TC39 metadata to the core. Member decorators cannot see their class, so
 * they record into `context.metadata`; the entries are replayed into the core `MetadataBuilder` — the
 * same calls the legacy decorators make — by the first class decorator, or, for a class without a class
 * decorator (a plain base class), by the metadata source the core runs before it reads the class.
 */
export class Tc39Metadata {
  private static readonly flushed = new WeakSet<object>();

  /**
   * Validates the context: a TC39 decorator applied with legacy arguments means the two decorator
   * packages are mixed.
   *
   * @param decorator - Decorator name used in the error message.
   * @param context - The raw second decorator argument.
   * @returns The context, typed.
   * @throws {ConfigurationError} When the decorator was applied as a legacy decorator.
   */
  static context(decorator: string, context: unknown): AnyContext {
    if (!DecoratorGuard.isTc39Context(context)) {
      throw new ConfigurationError(
        `${decorator} from "@venloc/typemo-decorators" is a TC39 decorator, but it was applied as a legacy decorator (experimentalDecorators is on). Use "@venloc/typemo" in a legacy project; the two packages cannot be mixed`,
      );
    }
    return context as AnyContext;
  }

  /**
   * The field name of a field context; accessors, methods and symbol keys are refused.
   *
   * @param decorator - Decorator name used in error messages.
   * @param context - The decorator context.
   * @returns The field name.
   * @throws {ConfigurationError} When the member is not a string-named field.
   */
  static fieldName(decorator: string, context: AnyContext): string {
    if (context.kind !== "field") {
      throw new ConfigurationError(
        `${decorator} on "${String(context.name)}", which is a ${context.kind} (getters are virtuals and need no decorator)`,
      );
    }
    if (typeof context.name !== "string") {
      throw new ConfigurationError(`${decorator} on a symbol-keyed field (schema fields have string names)`);
    }
    return context.name;
  }

  /**
   * The type must be a thunk `() => T`; a class or a constructor (`@Prop(String)`) is refused, because a
   * thunk can reference classes declared later.
   *
   * @param decorator - Decorator name used in error messages.
   * @param context - The decorator context.
   * @param type - The value passed as the type.
   * @throws {ConfigurationError} When `type` is not a thunk.
   */
  static assertThunk(decorator: string, context: AnyContext, type: unknown): void {
    if (typeof type !== "function" || Object.hasOwn(type, "prototype")) {
      throw new ConfigurationError(
        `${decorator} "${String(context.name)}": the type must be a thunk () => T (for example () => String), got ${typeof type === "function" ? type.name || "a function" : typeof type}`,
      );
    }
  }

  /**
   * Records a member entry; `static` and `#private` members are refused.
   *
   * @param decorator - Decorator name used in error messages.
   * @param context - The decorator context.
   * @param entry - The member declaration to store.
   * @throws {ConfigurationError} When the member is static or `#private`.
   */
  static record(decorator: string, context: AnyContext, entry: MemberEntry): void {
    const name = String(context.name);
    if (context.static === true) {
      throw new ConfigurationError(`${decorator} on static member "${name}" (static members are not schema members)`);
    }
    if (context.private === true) {
      throw new ConfigurationError(
        `${decorator} on private field "${name}" (#private fields cannot be schema members)`,
      );
    }
    const bag = context.metadata as Record<PropertyKey, unknown> | undefined;
    if (bag === undefined) {
      throw new ConfigurationError(
        `${decorator} on "${name}": the runtime gives no decorator metadata (Symbol.metadata is missing)`,
      );
    }
    if (!Object.hasOwn(bag, ENTRIES)) bag[ENTRIES] = [];
    (bag[ENTRIES] as MemberEntry[]).push(entry);
  }

  /**
   * Replays the recorded member entries of `target` into the core once.
   *
   * @param target - The decorated class.
   * @param metadata - Its `Symbol.metadata` object.
   * @throws {ConfigurationError} When the class also carries legacy decorator metadata.
   */
  static flush(target: ClassRef, metadata: DecoratorMetadataObject | null | undefined): void {
    if (metadata === null || metadata === undefined || Tc39Metadata.flushed.has(metadata)) return;
    Tc39Metadata.flushed.add(metadata);
    if (!Object.hasOwn(metadata, ENTRIES)) return;
    const entries = (metadata as Record<PropertyKey, unknown>)[ENTRIES] as readonly MemberEntry[];
    if (entries.length > 0 && MetadataSources.hasRecords(target)) {
      throw new ConfigurationError(
        `${target.name}: carries both legacy ("@venloc/typemo") and TC39 ("@venloc/typemo-decorators") decorator metadata; use one decorator package per project`,
      );
    }
    const builder = MetadataBuilder.for(target, "tc39");
    for (const entry of entries) {
      if (entry.kind === "field")
        builder.addField(entry.key, entry.type, entry.options as Readonly<Record<string, unknown>>);
      else if (entry.kind === "virtual") builder.addVirtual(entry.key, entry.options);
      else if (entry.kind === "tenant") builder.markTenantField(entry.key);
      else builder.addHook(entry.phase, entry.events, entry.fn, entry.key);
    }
  }

  /**
   * The metadata source: a class decorated only on its members is read from `Class[Symbol.metadata]`.
   *
   * @param target - The class the core is about to read.
   */
  static load(target: ClassRef): void {
    if (!Object.hasOwn(target, Symbol.metadata)) return;
    Tc39Metadata.flush(target, (target as unknown as Record<symbol, DecoratorMetadataObject | null>)[Symbol.metadata]);
  }
}

MetadataSources.add(Tc39Metadata.load);
