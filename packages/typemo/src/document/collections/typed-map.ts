import type { MapNode, PathNode } from "../../schema/compiler/path-node.ts";
import { DirectWriteError } from "./direct-write-error.ts";
import type { ElementInput, ObjectData, PlainFormOf } from "./hydrated-types.ts";
import { Lineage } from "./lineage.ts";
import {
  COMMIT,
  DELTA,
  type FoundUnknown,
  HAS_CHANGES,
  MARK,
  NODE_OF,
  type NodeMark,
  type NodeSnapshot,
  type PathPair,
  type PlainFormOptions,
  type PlainOptions,
  RESET,
  RESTORE,
  REVERT_RESET,
  SNAPSHOT,
  TO_PLAIN,
  type Tracked,
  type TrackedFactory,
  TrackedProtocol,
  UNKNOWN,
  UNMARK,
} from "./tracked-protocol.ts";
import type { DeltaBuilder } from "./update-ops.ts";

/**
 * A `Map<string, V>` field of a hydrated document (stored as an embedded object, `Spec.map`). A
 * `ReadonlyMap` plus tracked `set`/`delete`/`clear`:
 * - keys are checked at once: a string, not empty, no `.`, not starting with `$`, not `__proto__`
 *   — `CastError` reason `key`;
 * - values are cast through the value node at once; errors are THROWN (Mongoose swallowed them into
 *   `invalidate`);
 * - the journal per key gives `$set: { "path.key": v }` and `$unset: { "path.key": "" }`; `clear()` gives
 *   `$set: { path: {} }`; changes inside a value (a subdocument, an array) give ops under `path.key`.
 *
 * @example
 * ```ts
 * const user = await Users.findOne({ name: "Ann" }).orFail();
 * user.scores.set("math", 5); // saved as { $set: { "scores.math": 5 } }
 * user.scores.delete("art"); // saved as { $unset: { "scores.art": "" } }
 * ```
 */
export interface TypedMap<V> extends ReadonlyMap<string, V> {
  /**
   * Sets a value, tracked as `$set: { "path.key": value }`.
   *
   * @param key - The key: a non-empty string without `.`, not starting with `$`, not `__proto__`.
   * @param value - The value, cast through the value node at once.
   * @returns This map.
   * @throws {CastError} When the key is invalid or the value cannot be cast.
   */
  set(key: string, value: ElementInput<V>): this;
  /**
   * Removes a key, tracked as `$unset: { "path.key": "" }`.
   *
   * @param key - The key to remove.
   * @returns `true` when the key existed.
   */
  delete(key: string): boolean;
  /** Removes every entry; saved as `$set: { path: {} }`. */
  clear(): void;
  /** The object form: an untracked native `Map` of the values in their object form. */
  $toObject(): Map<string, ObjectData<V>>;
  /**
   * The plain form: exactly what the document's `$toPlain()` gives at this path — ids, int64,
   * `Decimal128`, `UUID` as strings, `Date`/`RegExp`/`Map` kept; `Hidden` fields of subdocuments out unless
   * `{ hidden: true }`.
   *
   * @param options - Plain-form options.
   */
  $toPlain(options?: PlainFormOptions & { readonly hidden?: false }): Map<string, PlainFormOf<V, false>>;
  /**
   * The plain form with the `Hidden` fields of subdocuments included.
   *
   * @param options - Plain-form options with `hidden: true`.
   */
  $toPlain(options: PlainFormOptions & { readonly hidden: true }): Map<string, PlainFormOf<V, true>>;
}

/**
 * The saved state of a tracked Map.
 *
 * @example
 * ```ts
 * const snapshot = map[SNAPSHOT](); // { kind: "map", entries, shadow, whole, ... }
 * ```
 */
interface MapSnapshot extends NodeSnapshot {
  /** Discriminates the snapshot kind. */
  readonly kind: "map";
  /** The entries at snapshot time. */
  readonly entries: readonly (readonly [string, unknown])[];
  /** The shadow copy used to detect writes around the methods. */
  readonly shadow: readonly (readonly [string, unknown])[];
  /** Whether the whole Map was to be written. */
  readonly whole: boolean;
  /** The keys set since the last save. */
  readonly setKeys: readonly string[];
  /** The keys deleted since the last save. */
  readonly deletedKeys: readonly string[];
  /** The tracked values replaced since the last save. */
  readonly replaced: readonly (readonly [string, unknown])[];
  /** The snapshots of the tracked values by key. */
  readonly children: readonly (readonly [string, NodeSnapshot])[];
}

/**
 * What a write took from a tracked Map: its journal, and the marks of its tracked values.
 *
 * @example
 * ```ts
 * const mark = map[MARK](); // { kind: "map", whole, setKeys, deletedKeys, replaced, children }
 * ```
 */
interface MapMark extends NodeMark {
  /** Discriminates the mark kind. */
  readonly kind: "map";
  /** Whether the whole Map was to be written. */
  readonly whole: boolean;
  /** The keys set. */
  readonly setKeys: readonly string[];
  /** The keys deleted. */
  readonly deletedKeys: readonly string[];
  /** The tracked values replaced. */
  readonly replaced: readonly (readonly [string, unknown])[];
  /** The marks of the tracked values. */
  readonly children: readonly (readonly [Tracked, NodeMark])[];
}

/**
 * The runtime of {@link TypedMap}: a real `Map` subclass (no Proxy); the shadow catches `Map.prototype.set.call`.
 * For Maps of OBJECTS (subdocuments, arrays, Maps) every value handed out by a read method — `get`, `values`,
 * `entries`, `forEach`, iteration — or put by `set` is marked ACCESSED, and `$getChanges`/save compare only
 * those with the baseline (a value nobody was given cannot have changed). The core reads through `super`
 * (no marks).
 *
 * @example
 * ```ts
 * const map = TrackedMap.create(node, [["math", 5]], factory);
 * map.set("art", 3);
 * ```
 */
export class TrackedMap<V> extends Map<string, V> implements Tracked {
  /* `constructor.name` shows the public type (`TypedMap`), not the name of the runtime class: the interface of that name shares this file. `this`, not the class name: the compiled output aliases the class name to a variable that is assigned only after the static blocks have run. */
  static {
    // biome-ignore lint/complexity/noThisInStatic: the class name is not yet bound in the compiled static block (see the comment above).
    Object.defineProperty(this, "name", { value: "TypedMap", configurable: true });
  }

  #node!: MapNode;
  #factory!: TrackedFactory;
  #shadow = new Map<string, unknown>();
  #whole = false;
  readonly #setKeys = new Set<string>();
  readonly #deletedKeys = new Set<string>();
  /** Tracked values replaced by `set(k, v)` since the last save (their unknown fields are checked). */
  #replaced: (readonly [string, unknown])[] = [];
  #ready = false;
  /** The values handed out or put by `set` (`undefined` for Maps of scalars: nothing to compare inside them). */
  #accessed: Set<unknown> | undefined;

  /**
   * A tracked Map of `node` holding `entries` (already hydrated).
   *
   * @param node - The schema node of the Map.
   * @param entries - The hydrated entries.
   * @param factory - Creates tracked values from input.
   */
  static create<E>(node: MapNode, entries: Iterable<readonly [string, E]>, factory: TrackedFactory): TrackedMap<E> {
    const map = new TrackedMap<E>();
    map.#node = node;
    map.#factory = factory;
    const kind = node.value.kind;
    if (kind !== "scalar" && kind !== "union") map.#accessed = new Set();
    for (const [key, value] of entries) {
      Map.prototype.set.call(map, key, value);
      map.#shadow.set(key, value);
      Lineage.attach(value, map, key);
    }
    map.#ready = true;
    return map;
  }

  /**
   * Sets a cast value and journals a `$set` of the key.
   *
   * @param key - The key.
   * @param value - The value.
   * @returns This map.
   * @throws {CastError} When the key is invalid or the value cannot be cast.
   */
  override set(key: string, value: unknown): this {
    /* `super()` of `Map` calls no `set` without entries, but stay safe if a subclass passes some. */
    if (!this.#ready) return super.set(key, value as V);
    const cast = this.#cast(key, value);
    const previous = super.get(key);
    /* The same value again is not a change (Mongoose gh-8652 / H501): the old value stays. */
    if (super.has(key) && TrackedProtocol.sameData(previous, cast)) return this;
    super.set(key, cast);
    this.#shadow.set(key, cast);
    if (TrackedProtocol.is(previous) && previous !== cast) this.#replaced.push([key, previous]);
    if (previous !== cast) this.#release(previous);
    Lineage.attach(cast, this, key);
    this.#mark(cast);
    this.#deletedKeys.delete(key);
    this.#setKeys.add(key);
    return this;
  }

  /**
   * Removes a key and journals an `$unset`.
   *
   * @param key - The key to remove.
   * @returns `true` when the key existed.
   */
  override delete(key: string): boolean {
    if (!super.has(key)) return false;
    this.#release(super.get(key));
    super.delete(key);
    this.#shadow.delete(key);
    this.#setKeys.delete(key);
    this.#deletedKeys.add(key);
    return true;
  }

  /**
   * Removes every entry; the save writes an empty object. It rewrites the whole Map, so a stored subdocument
   * value with fields unknown to the schema is refused at save like one replaced by `set(k, v)` (unless
   * `dropUnknownFields` accepts the loss); `delete(key)` is an `$unset` of that key and is not a loss.
   */
  override clear(): void {
    if (super.size === 0) return;
    for (const [key, value] of super.entries()) {
      if (TrackedProtocol.is(value)) this.#replaced.push([key, value]);
      this.#release(value);
    }
    super.clear();
    this.#shadow.clear();
    this.#whole = true;
  }

  /* ---- reads (the values handed out are marked accessed) ---- */

  /**
   * The value of a key; an object value is marked accessed.
   *
   * @param key - The key.
   */
  override get(key: string): V | undefined {
    const value = super.get(key);
    this.#mark(value);
    return value;
  }

  /** The values; each object value handed out is marked accessed. */
  override values(): MapIterator<V> {
    if (this.#accessed === undefined) return super.values();
    const values = super.values();
    const mark = (value: V): V => {
      this.#mark(value);
      return value;
    };
    return values.map(mark);
  }

  /** The entries; each object value handed out is marked accessed. */
  override entries(): MapIterator<[string, V]> {
    if (this.#accessed === undefined) return super.entries();
    const mark = (entry: [string, V]): [string, V] => {
      this.#mark(entry[1]);
      return entry;
    };
    return super.entries().map(mark);
  }

  /** Iterates the entries (marking object values accessed). */
  override [Symbol.iterator](): MapIterator<[string, V]> {
    return this.entries();
  }

  /**
   * Calls `callback` for each entry (marking object values accessed).
   *
   * @param callback - Called with the value, the key and the map.
   * @param thisArg - The `this` value for `callback`.
   */
  override forEach(callback: (value: V, key: string, map: Map<string, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this);
  }

  /** An untracked native `Map` of the values in their object form. */
  $toObject(): Map<string, unknown> {
    return this[TO_PLAIN]({ maps: "map" }) as Map<string, unknown>;
  }

  /**
   * The plain form of the Map (see the document's `$toPlain()`).
   *
   * @param options - Plain-form options.
   */
  $toPlain(options?: PlainFormOptions): unknown {
    return TrackedProtocol.plainForm(this, options);
  }

  /* ---- protocol ---- */

  /**
   * Adds the update of this Map to `out`: `$set` and `$unset` per key, a `$set` of the whole Map after `clear()`,
   * and the changes inside accessed values.
   *
   * @param at - The path of the Map.
   * @param out - The update builder.
   * @throws {DirectWriteError} When the Map was written around its methods and the builder is strict.
   */
  [DELTA](at: PathPair, out: DeltaBuilder): void {
    const problem = this.#directWrite();
    if (problem !== undefined) {
      if (out.strict) throw new DirectWriteError(at.code, problem);
      out.touched(at);
      return;
    }
    for (const [key, previous] of this.#replaced) out.replaced(previous, TrackedProtocol.join(at, key));
    if (this.#whole) {
      out.add("$set", at, out.value(this.#node, this), "none");
      return;
    }
    for (const key of this.#setKeys)
      out.add("$set", TrackedProtocol.join(at, key), out.value(this.#node.value, super.get(key)), "none");
    for (const key of this.#deletedKeys) out.add("$unset", TrackedProtocol.join(at, key), "", "none");
    const accessed = this.#accessed;
    if (accessed !== undefined && accessed.size === 0) return;
    for (const [key, value] of super.entries()) {
      /* Never handed out, so unchanged. */
      if (accessed !== undefined && !accessed.has(value)) continue;
      if (!this.#setKeys.has(key) && TrackedProtocol.is(value) && value[HAS_CHANGES]()) {
        value[DELTA](TrackedProtocol.join(at, key), out);
      }
    }
  }

  /** Whether the Map or any accessed value changed since the last reset. */
  [HAS_CHANGES](): boolean {
    if (this.#whole || this.#setKeys.size > 0 || this.#deletedKeys.size > 0) return true;
    if (this.#directWrite() !== undefined) return true;
    for (const value of this.#accessed ?? super.values())
      if (TrackedProtocol.is(value) && value[HAS_CHANGES]()) return true;
    return false;
  }

  /** Makes the current content the new baseline (after a successful save). */
  [RESET](): void {
    this.#replaced = [];
    this.#whole = false;
    this.#setKeys.clear();
    this.#deletedKeys.clear();
    this.#shadow = new Map(super.entries());
    for (const value of this.#accessed ?? super.values()) if (TrackedProtocol.is(value)) value[RESET]();
  }

  /** Captures the state (entries, shadow, journal, children) so it can be restored after a failed attempt. */
  [SNAPSHOT](): MapSnapshot {
    const children: [string, NodeSnapshot][] = [];
    for (const [key, value] of super.entries()) if (TrackedProtocol.is(value)) children.push([key, value[SNAPSHOT]()]);
    return {
      kind: "map",
      entries: [...super.entries()],
      shadow: [...this.#shadow],
      whole: this.#whole,
      setKeys: [...this.#setKeys],
      deletedKeys: [...this.#deletedKeys],
      replaced: [...this.#replaced],
      children,
    };
  }

  /**
   * Puts the Map back into the state of a snapshot.
   *
   * @param snapshot - A snapshot taken by `[SNAPSHOT]`.
   */
  [RESTORE](snapshot: NodeSnapshot): void {
    const state = snapshot as MapSnapshot;
    const kept = new Set(state.entries.map(([, value]) => value));
    for (const value of super.values()) if (!kept.has(value)) this.#release(value);
    super.clear();
    for (const [key, value] of state.entries) {
      super.set(key, value as V);
      Lineage.attach(value, this, key);
      /* A value back after a retry may be held by the caller (it was handed out in the failed attempt). */
      this.#mark(value);
    }
    this.#shadow = new Map(state.shadow);
    this.#restoreJournal(state);
    const children = new Map(state.children);
    for (const [key, value] of super.entries()) {
      const child = children.get(key);
      if (child !== undefined && TrackedProtocol.is(value)) value[RESTORE](child);
    }
  }

  /**
   * Undoes a `[RESET]` whose write failed: restores the journal, unless the Map changed meanwhile (then the
   * whole Map is written).
   *
   * @param snapshot - The snapshot taken before the write.
   */
  [REVERT_RESET](snapshot: NodeSnapshot): void {
    const state = snapshot as MapSnapshot;
    if (this.#directWrite() !== undefined) return;
    const same = super.size === state.entries.length && state.entries.every(([key, value]) => super.get(key) === value);
    if (!same || this.#setKeys.size > 0 || this.#deletedKeys.size > 0 || this.#whole) {
      this.#whole = true;
      return;
    }
    this.#restoreJournal(state);
    const children = new Map(state.children);
    for (const [key, value] of super.entries()) {
      const child = children.get(key);
      if (child !== undefined && TrackedProtocol.is(value)) value[REVERT_RESET](child);
    }
  }

  /** Takes the journal for a write in flight and clears it. */
  [MARK](): MapMark {
    const children: [Tracked, NodeMark][] = [];
    /* Only the values handed out can have changed. */
    for (const value of this.#accessed ?? super.values())
      if (TrackedProtocol.is(value)) children.push([value, value[MARK]()]);
    const mark: MapMark = {
      kind: "map",
      whole: this.#whole,
      setKeys: [...this.#setKeys],
      deletedKeys: [...this.#deletedKeys],
      replaced: this.#replaced,
      children,
    };
    this.#replaced = [];
    this.#whole = false;
    this.#setKeys.clear();
    this.#deletedKeys.clear();
    return mark;
  }

  /**
   * Confirms a write in the tracked values.
   *
   * @param mark - The mark taken by `[MARK]`.
   */
  [COMMIT](mark: NodeMark): void {
    for (const [value, child] of (mark as MapMark).children) value[COMMIT](child);
  }

  /**
   * Gives back the journal of a write that failed, merged with any change made since.
   *
   * @param mark - The mark taken by `[MARK]`.
   */
  [UNMARK](mark: NodeMark): void {
    const sent = mark as MapMark;
    const inFlight = this.#whole || this.#setKeys.size > 0 || this.#deletedKeys.size > 0;
    const hadJournal = sent.whole || sent.setKeys.length > 0 || sent.deletedKeys.length > 0;
    this.#replaced = [...sent.replaced, ...this.#replaced];
    if (!inFlight) {
      this.#whole = sent.whole;
      for (const key of sent.setKeys) this.#setKeys.add(key);
      for (const key of sent.deletedKeys) this.#deletedKeys.add(key);
    } else if (hadJournal) {
      /* Both journals are dirty: the current content covers the two. */
      this.#whole = true;
    }
    for (const [value, child] of sent.children) value[UNMARK](child);
  }

  /**
   * Collects the fields unknown to the schema found inside the values.
   *
   * @param path - The path of this Map relative to the collecting root.
   * @param found - The list to append to.
   */
  [UNKNOWN](path: string, found: FoundUnknown[]): void {
    for (const [key, value] of super.entries()) {
      if (TrackedProtocol.is(value)) value[UNKNOWN](path === "" ? key : `${path}.${key}`, found);
    }
  }

  /**
   * The Map in plain form: a native `Map` or a record, by `options.maps`.
   *
   * @param options - Plain-form options.
   */
  [TO_PLAIN](options: PlainOptions): unknown {
    const entries = [...super.entries()].map(([key, value]): [string, unknown] => [
      key,
      TrackedProtocol.toPlain(value, options),
    ]);
    if (options.maps === "map") return new Map(entries);
    const record: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return record;
  }

  /** The schema node of this Map. */
  [NODE_OF](): PathNode {
    return this.#node;
  }

  /* ---- internals ---- */

  /**
   * Restores the journal fields from a snapshot.
   *
   * @param state - The snapshot to read.
   */
  #restoreJournal(state: MapSnapshot): void {
    this.#replaced = [...state.replaced];
    this.#whole = state.whole;
    this.#setKeys.clear();
    for (const key of state.setKeys) this.#setKeys.add(key);
    this.#deletedKeys.clear();
    for (const key of state.deletedKeys) this.#deletedKeys.add(key);
  }

  /**
   * Key and value checked by the map node itself (the same rules and messages as a whole-Map cast).
   *
   * @param key - The key.
   * @param value - The value.
   * @throws {CastError} When the key is invalid or the value cannot be cast.
   */
  #cast(key: string, value: unknown): V {
    /*
     * Fast path: a valid key and a scalar value are the value caster's result (what the whole-Map
     * cast below ends in). Anything else — a bad key, a failing value, a container — goes the general
     * way, which gives the same result or throws the same `CastError` with the entry's path.
     */
    const valueNode = this.#node.value;
    if (
      TrackedMap.#plainKey(key) &&
      value !== undefined &&
      (valueNode.kind === "scalar" || valueNode.kind === "union")
    ) {
      if (value === null) {
        if (valueNode.nullable) return null as V;
      } else {
        try {
          return valueNode.caster.cast(value, "") as V;
        } catch {
          /* the general path below reports it */
        }
      }
    }
    const probe = this.#factory.fromInput(this.#node, new Map([[key, value]]), () => this.#displayPath()) as Map<
      string,
      V
    >;
    return probe.get(key) as V;
  }

  /**
   * Marks a value handed out (or put) as accessed: it is compared at the next save.
   *
   * @param value - The value.
   */
  #mark(value: unknown): void {
    if (typeof value === "object" && value !== null) this.#accessed?.add(value);
  }

  /**
   * A value that left the Map: unlinked, no longer compared.
   *
   * @param value - The value that left.
   */
  #release(value: unknown): void {
    Lineage.detach(value);
    if (typeof value === "object" && value !== null) this.#accessed?.delete(value);
  }

  /** The full path of the Map in its document, for error messages. */
  #displayPath(): string {
    return Lineage.fullPath(this) ?? this.#node.path;
  }

  /**
   * Whether the whole-Map cast accepts `key` as it is (a non-empty string without `.`, not starting with `$`,
   * not `__proto__`); anything else takes the general path.
   *
   * @param key - The candidate key.
   */
  static #plainKey(key: unknown): boolean {
    return typeof key === "string" && key !== "" && !key.includes(".") && !key.startsWith("$") && key !== "__proto__";
  }

  /** What went around `set()`/`delete()`, found by comparing with the shadow, or `undefined`. */
  #directWrite(): string | undefined {
    if (super.size !== this.#shadow.size) return "entries were added or removed around set()/delete()";
    for (const [key, value] of super.entries()) {
      if (!this.#shadow.has(key) || this.#shadow.get(key) !== value) {
        return `the value of "${key}" was replaced around set() (use set("${key}", value))`;
      }
    }
    return undefined;
  }
}
