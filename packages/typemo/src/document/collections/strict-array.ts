import { TypemoError } from "../../errors/typemo-error.ts";
import type { ArrayNode, PathNode } from "../../schema/compiler/path-node.ts";
import { ArrayJournal, type JournalState } from "./array-journal.ts";
import { DirectWriteError } from "./direct-write-error.ts";
import type { ElementInput, ObjectData, PlainFormOf, STRICT_ELEMENT } from "./hydrated-types.ts";
import { Lineage } from "./lineage.ts";
import { PartialArrayError } from "./partial-array-error.ts";
import {
  COMMIT,
  DELTA,
  type FoundUnknown,
  HAS_CHANGES,
  ITEMS,
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
import { ValueEquality } from "./value-equality.ts";

/**
 * The array of a hydrated document. It IS a `ReadonlyArray<T>`: reading, iteration, spread,
 * `map`/`filter` (plain arrays), `for…of`, `JSON.stringify` and `structuredClone` work natively.
 * Writing goes only through the methods below — `arr[i] = x` and `arr.length = 0` do not compile
 * (TS2542 / TS2540), `fill`/`copyWithin` do not exist. Every method casts its input through the element's
 * caster (`CastError` at once) and writes to the array's one journal, from which the save builds the
 * smallest update (`$push`, `$addToSet`, `$pullAll`, `$pop`, `$set path.i`, or `$set` of the whole array).
 *
 * Assigns to `readonly T[]`, not to `T[]` (use `$toObject()` or a spread for a mutable copy).
 *
 * @example
 * ```ts
 * const user = await Users.findOne({ name: "Ann" }).orFail();
 * user.tags.push("admin"); // saved as { $push: { tags: { $each: ["admin"] } } }
 * user.tags.set(0, "owner"); // saved as { $set: { "tags.0": "owner" } }
 * // user.tags[0] = "x"; // does not compile
 * ```
 */
export interface StrictArray<T> extends ReadonlyArray<T> {
  /** Phantom (type only): the element type, for `ElementInput`. */
  readonly [STRICT_ELEMENT]: T;
  /**
   * Appends; `$push` with `$each`.
   *
   * @param items - The elements to append, cast at once.
   * @returns The new length.
   * @throws {CastError} When an item cannot be cast to the element type.
   */
  push(...items: ElementInput<T>[]): number;
  /**
   * Prepends; `$push` with `$each` and `$position: 0`.
   *
   * @param items - The elements to prepend, cast at once.
   * @returns The new length.
   * @throws {CastError} When an item cannot be cast to the element type.
   */
  unshift(...items: ElementInput<T>[]): number;
  /**
   * Appends the items not yet present (by value, `equals` for BSON values); `$addToSet`.
   *
   * @param items - The candidate elements, cast at once.
   * @returns The elements that were added.
   * @throws {CastError} When an item cannot be cast to the element type.
   */
  addToSet(...items: ElementInput<T>[]): T[];
  /**
   * Removes every element equal to one of the values; `$pullAll`.
   *
   * @param values - The values to remove, cast at once.
   * @returns The elements that were removed.
   * @throws {CastError} When a value cannot be cast to the element type.
   */
  pull(...values: ElementInput<T>[]): T[];
  /** Removes the last element; `$pop: 1` (once per save; a second `pop`/`shift` rewrites the array). */
  pop(): T | undefined;
  /** Removes the first element; `$pop: -1`. */
  shift(): T | undefined;
  /**
   * As `Array#splice`; rewrites the whole array at save.
   *
   * @param start - The index to start at (negative counts from the end).
   * @param deleteCount - How many elements to remove; absent removes to the end.
   * @param items - The elements to insert, cast at once.
   * @returns The removed elements.
   * @throws {CastError} When an item cannot be cast to the element type.
   */
  splice(start: number, deleteCount?: number, ...items: ElementInput<T>[]): T[];
  /**
   * Sorts in place; rewrites the whole array at save.
   *
   * @param compare - The comparison function, as for `Array#sort`.
   * @returns This array.
   */
  sort(compare?: (a: T, b: T) => number): this;
  /**
   * Reverses in place; rewrites the whole array at save.
   *
   * @returns This array.
   */
  reverse(): this;
  /**
   * `arr[index] = value` of the strict variant; `$set: { "path.index": value }`. The index must exist.
   *
   * @param index - An existing position.
   * @param value - The new element, cast at once.
   * @returns This array.
   * @throws {TypemoError} When the index is not an existing position.
   * @throws {CastError} When the value cannot be cast to the element type.
   */
  set(index: number, value: ElementInput<T>): this;
  /**
   * `arr.length = 0` of the strict variant; `$set: { path: [] }`.
   *
   * @returns This array.
   */
  clear(): this;
  /**
   * Replaces the whole content; `$set` of the whole array.
   *
   * @param values - The new elements, cast at once.
   * @returns This array.
   * @throws {CastError} When a value cannot be cast to the element type.
   */
  replace(values: readonly ElementInput<T>[]): this;
  /**
   * The object form: an untracked copy — arrays, native `Map`s, plain objects; BSON values as they are
   * (`ObjectId`, `bigint`). The plain form (ids and int64 as strings) is the document's `$toPlain()`.
   */
  $toObject(): ObjectData<T>[];
  /**
   * The plain form: exactly what the document's `$toPlain()` gives at this path — ids, int64,
   * `Decimal128`, `UUID` as strings, `Date`/`RegExp`/`Map` kept; `Hidden` fields of subdocuments out unless
   * `{ hidden: true }`.
   *
   * @param options - Plain-form options.
   */
  $toPlain(options?: PlainFormOptions & { readonly hidden?: false }): PlainFormOf<T, false>[];
  /**
   * The plain form with the `Hidden` fields of subdocuments included.
   *
   * @param options - Plain-form options with `hidden: true`.
   */
  $toPlain(options: PlainFormOptions & { readonly hidden: true }): PlainFormOf<T, true>[];
}

/**
 * The saved state of a tracked array.
 *
 * @example
 * ```ts
 * const snapshot = array[SNAPSHOT](); // { kind: "array", items, shadow, journal, children }
 * ```
 */
interface ArraySnapshot extends NodeSnapshot {
  /** Discriminates the snapshot kind. */
  readonly kind: "array";
  /** The elements at snapshot time. */
  readonly items: readonly unknown[];
  /** The shadow copy used to detect writes around the methods. */
  readonly shadow: readonly unknown[];
  /** The journal state. */
  readonly journal: JournalState;
  /** The snapshots of tracked elements (`undefined` for elements without tracking). */
  readonly children: readonly (NodeSnapshot | undefined)[];
}

/**
 * What a write took from a tracked array: the journal it sends, and the marks of its tracked elements.
 *
 * @example
 * ```ts
 * const mark = array[MARK](); // { kind: "array", journal, children }
 * ```
 */
interface ArrayMark extends NodeMark {
  /** Discriminates the mark kind. */
  readonly kind: "array";
  /** `undefined`: the array had no journal (nothing was journaled since the last reset). */
  readonly journal: ArrayJournal | undefined;
  /** The marks of the tracked elements. */
  readonly children: readonly (readonly [Tracked, NodeMark])[];
}

/**
 * What `DELTA` reads when the array has no journal — never written (the journal of an array is
 * created by its first change, so a save that only reads the array allocates none).
 */
const NO_JOURNAL = new ArrayJournal();

/**
 * Whether `value` is an integer.
 *
 * @param value - The number to test.
 */
const isInteger = (value: number): boolean => Number.isInteger(value);

/**
 * Access tracking is used only for arrays of objects LONGER than this — when they are created, or as soon
 * as they grow past it; a shorter one keeps its elements natively and compares all of them at save (cheaper
 * than the accessors for a few elements).
 */
export const N1_THRESHOLD = 50;

/**
 * The runtime of {@link StrictArray} (and the base of the subdocument array). A real `Array` subclass,
 * no Proxy (a Proxy reads ~50× slower, breaks `structuredClone` and `#private`).
 *
 * A SHADOW (always on) mirrors every tracked mutation. A write that went around the methods (a cast
 * `arr[0] = x`, `length = 0`, `Array.prototype.push.call`) makes the array and the shadow differ; the
 * save sees it and throws `DirectWriteError` instead of guessing.
 *
 * For arrays of OBJECTS (subdocuments, nested arrays and Maps) the elements live in a STORE and the array's
 * own indexes are accessor properties over it (no Proxy). Every element read through the array — an index,
 * iteration, `find`/`map`/…, destructuring, `id()` — marks it ACCESSED; so do elements that enter through
 * the methods (the caller holds them). `$getChanges`/save compare with the baseline ONLY the accessed
 * elements: an element nobody was given cannot have changed. The mark stays until the element leaves the
 * array (a reference kept from before a save may still be written through). A write through an index setter
 * or a length change is recorded and refused at save (`DirectWriteError`, as the shadow does for arrays of
 * values).
 *
 * Access tracking applies to an array of objects with more than {@link N1_THRESHOLD} elements. A shorter one
 * works as an array of values: native elements, the shadow, every element compared at save. The mode is
 * chosen at creation by the length, and a short array that grows past the threshold through a method switches
 * to access tracking at once (`#trackIfLong`): every element it holds at that moment counts as accessed, so
 * no change made before the switch is missed, and a write around the methods made before it is still refused
 * at save. An array never switches back.
 *
 * @example
 * ```ts
 * const array = TrackedArray.create(node, ["a", "b"], factory, false);
 * array.push("c");
 * ```
 */
export class TrackedArray<T> extends Array<T> implements Tracked {
  /* `constructor.name` shows the public type (`StrictArray`), not the name of the runtime class: the interface of that name shares this file. `this`, not the class name: the compiled output aliases the class name to a variable that is assigned only after the static blocks have run. */
  static {
    // biome-ignore lint/complexity/noThisInStatic: the class name is not yet bound in the compiled static block (see the comment above).
    Object.defineProperty(this, "name", { value: "StrictArray", configurable: true });
  }

  /**
   * Makes derived arrays (`map`, `filter`, …) plain arrays, not tracked ones.
   */
  static override get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  #node!: ArrayNode;
  #factory!: TrackedFactory;
  /** The journal, created on first use (most hydrated arrays are only read). */
  #log: ArrayJournal | undefined;
  /** Set by `#fill` (the hydrated items themselves, no copy); unused with a store. */
  #shadow!: unknown[];
  #partial = false;
  /** Elements are scalars (no links, no tracked children): enables the fast paths. */
  #scalar = false;
  /** The elements of an array of objects (`undefined` for scalars: stored natively, checked by the shadow). */
  #store: T[] | undefined;
  /** The elements handed to user code or inserted by a method (only these are compared at save). */
  #accessed: Set<unknown> | undefined;
  /** The first write that went around the methods (an index setter, a length change). */
  #written: string | undefined;

  /** Shared index accessors (one pair per position, reused by every array): read marks, write is refused at save. */
  static readonly #accessors: PropertyDescriptor[] = [];

  /**
   * The shared accessor pair of one index, created on first use.
   *
   * @param index - The array position.
   */
  static #accessor(index: number): PropertyDescriptor {
    let descriptor = TrackedArray.#accessors[index];
    if (descriptor === undefined) {
      descriptor = {
        get(this: TrackedArray<unknown>): unknown {
          return TrackedArray.#read(this, index);
        },
        set(this: TrackedArray<unknown>, value: unknown): void {
          TrackedArray.#writeAround(this, index, value);
        },
        enumerable: true,
        configurable: true,
      };
      TrackedArray.#accessors[index] = descriptor;
    }
    return descriptor;
  }

  /**
   * Reads one element through an index accessor and marks an object element as accessed.
   *
   * @param array - The array read.
   * @param index - The position read.
   */
  static #read(array: TrackedArray<unknown>, index: number): unknown {
    const item = array.#store?.[index];
    if (typeof item === "object" && item !== null) array.#accessed?.add(item);
    return item;
  }

  /**
   * Records a write through an index setter (refused at save) and applies it to the store.
   *
   * @param array - The array written.
   * @param index - The position written.
   * @param value - The value written.
   */
  static #writeAround(array: TrackedArray<unknown>, index: number, value: unknown): void {
    array.#written ??= `position ${index} was assigned directly (use set(${index}, value))`;
    if (array.#store !== undefined) array.#store[index] = value;
  }

  /**
   * A tracked array of `node` holding `items` (already hydrated: containers tracked, subdocuments instances). The
   * array takes `items` over as its shadow: the caller passes a fresh array it does not keep.
   *
   * @param node - The schema node of the array.
   * @param items - The hydrated elements.
   * @param factory - Creates tracked values from input.
   * @param partial - Whether the array was loaded by a projection (positional writes are then refused).
   */
  static create<E>(node: ArrayNode, items: readonly E[], factory: TrackedFactory, partial: boolean): TrackedArray<E> {
    return TrackedArray.init(new TrackedArray<E>(), node, items, factory, partial);
  }

  /**
   * Shared by the subclasses: fills a fresh instance.
   *
   * @param array - The fresh instance.
   * @param node - The schema node of the array.
   * @param items - The hydrated elements.
   * @param factory - Creates tracked values from input.
   * @param partial - Whether the array was loaded by a projection.
   * @returns The same instance.
   */
  protected static init<E, A extends TrackedArray<E>>(
    array: A,
    node: ArrayNode,
    items: readonly E[],
    factory: TrackedFactory,
    partial: boolean,
  ): A {
    array.#node = node;
    array.#factory = factory;
    array.#partial = partial;
    array.#scalar = node.element.kind === "scalar" || node.element.kind === "union";
    if (!array.#scalar && items.length > N1_THRESHOLD) {
      array.#store = [];
      array.#accessed = new Set();
    }
    array.#fill(items);
    return array;
  }

  /** The element node (for the subclasses). */
  protected get elementNode(): PathNode {
    return this.#node.element;
  }

  /** The factory that creates tracked values (for the subclasses). */
  protected get factory(): TrackedFactory {
    return this.#factory;
  }

  /** The journal, created on first use (for the subclasses). */
  protected get journal(): ArrayJournal {
    return this.#journal;
  }

  /** The journal, created on first use. */
  get #journal(): ArrayJournal {
    this.#log ??= new ArrayJournal();
    return this.#log;
  }

  /** The elements as the core reads them: never marks them accessed. */
  protected items(): readonly T[] {
    return this.#store ?? (this as readonly T[]);
  }

  /**
   * Marks an element as handed to user code (the subclasses' lookups, e.g. `id()`).
   *
   * @param item - The element given out.
   */
  protected markAccessed(item: unknown): void {
    if (typeof item === "object" && item !== null) this.#accessed?.add(item);
  }

  /** The elements the core reads (`Lineage` positions), without marking them. */
  [ITEMS](): readonly unknown[] {
    return this.items();
  }

  /* ---- mutations ---- */

  /**
   * Appends cast items and journals a `$push`.
   *
   * @param items - The elements to append.
   * @returns The new length.
   * @throws {CastError} When an item cannot be cast to the element type.
   */
  override push(...items: unknown[]): number {
    const cast = this.castItems(items, this.length);
    const store = this.#store;
    if (store !== undefined) {
      const before = this.#checkLength();
      for (const item of cast) {
        store.push(item);
        this.#inserted(item);
      }
      this.#sync(before);
    } else {
      for (const item of cast) this.#append(item);
      this.#trackIfLong();
    }
    this.#journal.record("$push", cast);
    return this.length;
  }

  /**
   * Prepends cast items and journals a `$push` with `$position: 0`.
   *
   * @param items - The elements to prepend.
   * @returns The new length.
   * @throws {CastError} When an item cannot be cast to the element type.
   */
  override unshift(...items: unknown[]): number {
    const cast = this.castItems(items, 0);
    if (cast.length === 0) return this.length;
    /* In place, like the native method: a rebuild of the whole array per call was O(n) with a large constant. */
    const store = this.#store;
    if (store !== undefined) {
      const before = this.#checkLength();
      store.unshift(...cast);
      this.#sync(before);
      for (const item of cast) this.#inserted(item);
    } else {
      Array.prototype.unshift.call(this, ...cast);
      this.#shadow.unshift(...cast);
      for (const item of cast) Lineage.attach(item, this);
      this.#trackIfLong();
    }
    this.#journal.record("$unshift", cast);
    return this.length;
  }

  /**
   * Appends the cast items not yet present and journals an `$addToSet`.
   *
   * @param items - The candidate elements.
   * @returns The elements that were added.
   * @throws {CastError} When an item cannot be cast to the element type.
   */
  addToSet(...items: unknown[]): T[] {
    const cast = this.castItems(items, this.length);
    const added: T[] = [];
    const present = this.items();
    for (const item of cast) {
      if (!ValueEquality.isAmong(item, present) && !ValueEquality.isAmong(item, added)) added.push(item);
    }
    const store = this.#store;
    if (store !== undefined) {
      const before = this.#checkLength();
      for (const item of added) {
        store.push(item);
        this.#inserted(item);
      }
      this.#sync(before);
    } else {
      for (const item of added) this.#append(item);
      this.#trackIfLong();
    }
    this.#journal.record("$addToSet", added);
    return added;
  }

  /**
   * Removes every element equal to one of the values and journals a `$pullAll`.
   *
   * @param values - The values to remove.
   * @returns The elements that were removed.
   */
  pull(...values: unknown[]): T[] {
    const removed = this.items().filter((item) => ValueEquality.isAmong(item, values));
    if (removed.length === 0) return [];
    this.#removeAll(removed);
    const distinct: T[] = [];
    for (const item of removed) if (!ValueEquality.isAmong(item, distinct)) distinct.push(item);
    this.#journal.record("$pullAll", distinct);
    return removed;
  }

  /** Removes the last element and journals a `$pop: 1`. */
  override pop(): T | undefined {
    const store = this.#store;
    if (store !== undefined) {
      if (store.length === 0) return undefined;
      const before = this.#checkLength();
      const last = store.pop() as T;
      this.#sync(before);
      this.#release(last);
      this.#journal.recordPop(1);
      return last;
    }
    if (this.length === 0) return undefined;
    const last = Array.prototype.pop.call(this) as T;
    this.#shadow.pop();
    this.#release(last);
    this.#journal.recordPop(1);
    return last;
  }

  /** Removes the first element and journals a `$pop: -1`. */
  override shift(): T | undefined {
    const store = this.#store;
    if (store !== undefined) {
      if (store.length === 0) return undefined;
      const before = this.#checkLength();
      const first = store.shift() as T;
      this.#sync(before);
      this.#release(first);
      this.#journal.recordPop(-1);
      return first;
    }
    if (this.length === 0) return undefined;
    const first = Array.prototype.shift.call(this) as T;
    this.#shadow.shift();
    this.#release(first);
    this.#journal.recordPop(-1);
    return first;
  }

  /**
   * As `Array#splice`; the save rewrites the whole array.
   *
   * @param start - The index to start at (negative counts from the end).
   * @param deleteCount - How many elements to remove; absent removes to the end.
   * @param items - The elements to insert.
   * @returns The removed elements.
   * @throws {CastError} When an item cannot be cast to the element type.
   */
  override splice(start: number, deleteCount?: number, ...items: unknown[]): T[] {
    const length = this.items().length;
    const from = start < 0 ? Math.max(length + start, 0) : Math.min(start, length);
    const cast = this.castItems(items, from);
    const store = this.#store;
    let removed: T[];
    if (store !== undefined) {
      const before = this.#checkLength();
      /* `splice(start)` removes to the end; the length is an upper bound for the count. */
      removed = store.splice(from, deleteCount ?? length, ...cast);
      this.#sync(before);
      for (const item of removed) this.#release(item);
      for (const item of cast) this.#inserted(item);
    } else {
      removed = Array.prototype.splice.call(this, from, deleteCount ?? length, ...cast) as T[];
      /*
       * The same splice on the shadow: a copy of the whole array per call made `splice` O(n) even at the end
       * (1 260× slower than Mongoose on 1e5 elements). The shadow is identical to the array before and after.
       */
      this.#shadow.splice(from, removed.length, ...cast);
      for (const item of removed) this.#release(item);
      for (const item of cast) Lineage.attach(item, this);
      this.#trackIfLong();
    }
    this.#recordDropped(removed, from);
    if (removed.length > 0 || cast.length > 0) this.#journal.markWhole();
    return removed;
  }

  /**
   * Sorts in place; the save rewrites the whole array.
   *
   * @param compare - The comparison function, as for `Array#sort`.
   * @returns This array.
   */
  override sort(compare?: (a: T, b: T) => number): this {
    const store = this.#store;
    if (store !== undefined) {
      this.#checkLength();
      /* The comparator is user code: the elements it is given are accessed. */
      store.sort(
        compare === undefined
          ? undefined
          : (a, b) => {
              this.markAccessed(a);
              this.markAccessed(b);
              return compare(a, b);
            },
      );
    } else {
      Array.prototype.sort.call(this, compare);
      this.#shadow = [...this];
    }
    if (this.items().length > 1) this.#journal.markWhole();
    return this;
  }

  /**
   * Reverses in place; the save rewrites the whole array.
   *
   * @returns This array.
   */
  override reverse(): this {
    const store = this.#store;
    if (store !== undefined) {
      this.#checkLength();
      store.reverse();
    } else {
      Array.prototype.reverse.call(this);
      this.#shadow = [...this];
    }
    if (this.items().length > 1) this.#journal.markWhole();
    return this;
  }

  /**
   * Replaces the element at an existing position and journals a positional `$set`.
   *
   * @param index - An existing position.
   * @param value - The new element.
   * @returns This array.
   * @throws {TypemoError} When the index is not an existing position.
   * @throws {CastError} When the value cannot be cast to the element type.
   */
  set(index: number, value: unknown): this {
    const length = this.items().length;
    if (!isInteger(index) || index < 0 || index >= length) {
      throw new TypemoError(
        `set(${index}) on "${this.#displayPath()}": the index must be an existing position 0..${length - 1} (use push() to append)`,
      );
    }
    const [cast] = this.castItems([value], index);
    const previous = this.items()[index];
    /* The same value again is not a change (Mongoose H501): the old element stays. */
    if (TrackedProtocol.sameData(previous, cast)) return this;
    const store = this.#store;
    if (store !== undefined) {
      store[index] = cast as T;
      this.#release(previous);
      this.#inserted(cast);
    } else {
      this[index] = cast as T;
      this.#shadow[index] = cast;
      this.#release(previous);
      Lineage.attach(cast, this);
    }
    if (TrackedProtocol.is(previous)) this.#journal.recordReplaced(index, previous);
    this.#journal.markIndex(index);
    return this;
  }

  /**
   * Removes every element; the save writes an empty array.
   *
   * @returns This array.
   */
  clear(): this {
    if (this.items().length === 0) return this;
    const removed = [...this.items()];
    this.#rewrite([]);
    for (const item of removed) this.#release(item);
    this.#recordDropped(removed, 0);
    this.#journal.markWhole();
    return this;
  }

  /**
   * Replaces the whole content; the save writes the whole array.
   *
   * @param values - The new elements.
   * @returns This array.
   * @throws {CastError} When a value cannot be cast to the element type.
   */
  replace(values: readonly unknown[]): this {
    const cast = this.castItems(values, 0);
    const removed = [...this.items()];
    this.#rewrite(cast);
    const kept = new Set<unknown>(cast);
    removed.forEach((item, index) => {
      if (kept.has(item)) return;
      this.#release(item);
      if (TrackedProtocol.is(item)) this.#journal.recordReplaced(index, item);
    });
    for (const item of cast) this.#inserted(item);
    if (this.#store === undefined) this.#trackIfLong();
    this.#journal.markWhole();
    return this;
  }

  /** An untracked copy: arrays, native `Map`s, plain objects; BSON values as they are. */
  $toObject(): unknown[] {
    return this[TO_PLAIN]({ maps: "map" });
  }

  /**
   * The plain form of the array (see the document's `$toPlain()`).
   *
   * @param options - Plain-form options.
   */
  $toPlain(options?: PlainFormOptions): unknown {
    return TrackedProtocol.plainForm(this, options);
  }

  /* ---- protocol ---- */

  /**
   * Adds the update of this array to `out`: a direct write is an error (or a touch when not strict), otherwise
   * the smallest of `$push`, `$addToSet`, `$pullAll`, `$pull`, `$pop`, positional `$set`, or a `$set` of the whole array.
   *
   * @param at - The path of the array.
   * @param out - The update builder.
   * @throws {DirectWriteError} When the array was written around its methods and the builder is strict.
   * @throws {PartialArrayError} When the operation needs the complete array but it was loaded partially.
   */
  [DELTA](at: PathPair, out: DeltaBuilder): void {
    const problem = this.#directWrite();
    if (problem !== undefined) {
      if (out.strict) throw new DirectWriteError(at.code, problem);
      out.touched(at);
      return;
    }
    const journal = this.#log ?? NO_JOURNAL;
    const items = this.items();
    /* An element dropped and put back is written with the array: its unknown fields are found there, once. */
    if (journal.replaced.length > 0) {
      const present = new Set<unknown>(items);
      for (const [index, previous] of journal.replaced)
        if (!present.has(previous)) out.replaced(previous, TrackedProtocol.join(at, String(index)));
    }
    const changed: [number, Tracked][] = [];
    const accessed = this.#accessed;
    /* Only the elements handed out can have changed. */
    if (accessed === undefined || accessed.size > 0) {
      items.forEach((item, index) => {
        if (
          TrackedProtocol.is(item) &&
          (accessed === undefined || accessed.has(item)) &&
          !journal.isAdded(item) &&
          item[HAS_CHANGES]()
        )
          changed.push([index, item]);
      });
    }
    /*
     * An atomic on the array plus a write inside one of its elements touch the same path: the server
     * answers 40 ConflictingUpdateOperators. The whole array is written instead.
     */
    if (journal.whole || (journal.kind !== undefined && changed.length > 0)) {
      this.#assertComplete(at, "a $set of the whole array");
      out.add("$set", at, out.value(this.#node, this), "increment");
      return;
    }
    const element = this.#node.element;
    const each = (): unknown[] => journal.values.map((value) => out.value(element, value));
    switch (journal.kind) {
      case "$push":
        out.add("$push", at, { $each: each() }, "increment");
        return;
      case "$unshift":
        out.add("$push", at, { $each: each(), $position: 0 }, "increment");
        return;
      case "$addToSet":
        out.add("$addToSet", at, { $each: each() }, "increment");
        return;
      case "$pullAll":
        out.add("$pullAll", at, each(), "increment");
        return;
      case "$pullIds":
        out.add("$pull", at, { _id: { $in: this.pullIds(out, journal.values) } }, "increment");
        return;
      case "$pop":
        this.#assertComplete(at, "$pop");
        out.add("$pop", at, journal.pop ?? 1, "increment");
        return;
      case undefined:
        break;
    }
    if (journal.indexes.size > 0) this.#assertComplete(at, "a positional $set");
    for (const index of journal.indexes) {
      if (index < items.length)
        out.add("$set", TrackedProtocol.join(at, String(index)), out.value(element, items[index]), "where");
    }
    for (const [index, item] of changed) {
      if (journal.indexes.has(index)) continue;
      if (this.#partial) this.#assertComplete(at, "a positional $set inside an element");
      item[DELTA](TrackedProtocol.join(at, String(index)), out);
      out.bump("where");
    }
  }

  /** Whether the array or any accessed element changed since the last reset. */
  [HAS_CHANGES](): boolean {
    if (this.#directWrite() !== undefined || this.#log?.dirty === true) return true;
    /* Only the elements handed out can have changed. */
    for (const item of this.#accessed ?? this.items()) if (TrackedProtocol.is(item) && item[HAS_CHANGES]()) return true;
    return false;
  }

  /** Makes the current content the new baseline (after a successful save). */
  [RESET](): void {
    this.#log?.reset();
    if (this.#store !== undefined) {
      this.#written = undefined;
      this.#sync(this.length);
    } else {
      this.#shadow = [...this];
    }
    for (const item of this.#accessed ?? this.items()) if (TrackedProtocol.is(item)) item[RESET]();
  }

  /** Captures the state (elements, shadow, journal, children) so it can be restored after a failed attempt. */
  [SNAPSHOT](): ArraySnapshot {
    return {
      kind: "array",
      items: [...this.items()],
      shadow: this.#store === undefined ? [...this.#shadow] : [...this.#store],
      journal: this.#journal.state(),
      children: this.items().map((item) => (TrackedProtocol.is(item) ? item[SNAPSHOT]() : undefined)),
    };
  }

  /**
   * Puts the array back into the state of a snapshot.
   *
   * @param snapshot - A snapshot taken by `[SNAPSHOT]`.
   */
  [RESTORE](snapshot: NodeSnapshot): void {
    const state = snapshot as ArraySnapshot;
    const kept = new Set<unknown>(state.items);
    for (const item of this.items()) if (!kept.has(item)) this.#release(item);
    this.#rewrite(state.items as T[]);
    if (this.#store === undefined) this.#shadow = [...state.shadow];
    else this.#written = undefined;
    this.#journal.restore(state.journal);
    state.items.forEach((item, index) => {
      Lineage.attach(item, this);
      /* An element back after a retry may be held by the caller (it was handed out in the failed attempt). */
      this.markAccessed(item);
      const child = state.children[index];
      if (child !== undefined && TrackedProtocol.is(item)) item[RESTORE](child);
    });
  }

  /**
   * Undoes a `[RESET]` whose write failed: restores the journal, unless the array changed meanwhile (then the
   * whole array is written).
   *
   * @param snapshot - The snapshot taken before the write.
   */
  [REVERT_RESET](snapshot: NodeSnapshot): void {
    const state = snapshot as ArraySnapshot;
    if (this.#directWrite() !== undefined) return;
    const items = this.items();
    if (
      this.#log?.dirty === true ||
      items.length !== state.items.length ||
      items.some((item, i) => item !== state.items[i])
    ) {
      /* Changed while the failed write was in flight: the current content covers both, write it whole. */
      this.#journal.markWhole();
      return;
    }
    this.#journal.restore(state.journal);
    state.items.forEach((item, index) => {
      const child = state.children[index];
      if (child !== undefined && TrackedProtocol.is(item)) item[REVERT_RESET](child);
    });
  }

  /**
   * Takes the journal for a write in flight: what was journaled goes with the write; a change made while it is in
   * flight creates a new journal (lazily).
   */
  [MARK](): ArrayMark {
    const journal = this.#log;
    this.#log = undefined;
    const children: [Tracked, NodeMark][] = [];
    /* Only the elements handed out can have changed (a mark of the others would be empty). */
    if (!this.#scalar)
      for (const item of this.#accessed ?? this.items())
        if (TrackedProtocol.is(item)) children.push([item, item[MARK]()]);
    return { kind: "array", journal, children };
  }

  /**
   * Confirms a write: the sent journal is dropped (it was replaced at `[MARK]`); what was journaled since is
   * the next change.
   *
   * @param mark - The mark taken by `[MARK]`.
   */
  [COMMIT](mark: NodeMark): void {
    for (const [item, child] of (mark as ArrayMark).children) item[COMMIT](child);
  }

  /**
   * Gives back the journal of a write that failed, merged with any change made since.
   *
   * @param mark - The mark taken by `[MARK]`.
   */
  [UNMARK](mark: NodeMark): void {
    const sent = (mark as ArrayMark).journal;
    if (this.#log?.dirty !== true) this.#log = sent;
    else if (sent?.dirty === true) {
      /* Both journals are dirty: the current content covers the two. */
      this.#journal.markWhole();
      for (const [index, previous] of sent.replaced) this.#journal.recordReplaced(index, previous);
    }
    for (const [item, child] of (mark as ArrayMark).children) item[UNMARK](child);
  }

  /**
   * Collects the fields unknown to the schema found inside the elements.
   *
   * @param path - The path of this array relative to the collecting root.
   * @param found - The list to append to.
   */
  [UNKNOWN](path: string, found: FoundUnknown[]): void {
    if (this.#scalar) return;
    this.items().forEach((item, index) => {
      if (TrackedProtocol.is(item)) item[UNKNOWN](path === "" ? String(index) : `${path}.${index}`, found);
    });
  }

  /**
   * The elements converted to plain form.
   *
   * @param options - Plain-form options.
   */
  [TO_PLAIN](options: PlainOptions): unknown[] {
    return Array.from(this.items(), (item) => TrackedProtocol.toPlain(item, options));
  }

  /** The schema node of this array. */
  [NODE_OF](): PathNode {
    return this.#node;
  }

  /* ---- for the subclasses ---- */

  /**
   * Casts and hydrates items for positions starting at `from` (error paths name the position).
   *
   * @param items - The input items.
   * @param from - The position of the first item in the array.
   * @throws {CastError} When an item cannot be cast to the element type.
   */
  protected castItems(items: readonly unknown[], from: number): T[] {
    const element = this.#node.element;
    const out = new Array<T>(items.length);
    const scalar = this.#scalar;
    for (let offset = 0; offset < items.length; offset++) {
      const item = items[offset];
      /*
       * Fast path: a scalar element is its caster's result (the general path — plain-input copy,
       * the walker, the hydrator — ends in the same `caster.cast` for a scalar). Anything that does
       * not pass goes the general way, which throws the same `CastError` with the element's path.
       */
      if (scalar && item !== undefined) {
        if (item === null) {
          if (element.nullable) {
            out[offset] = null as T;
            continue;
          }
        } else {
          try {
            out[offset] = element.caster.cast(item, "") as T;
            continue;
          } catch {
            /* the general path below reports it */
          }
        }
      }
      out[offset] = this.#factory.fromInput(element, item, () => `${this.#displayPath()}.${from + offset}`) as T;
    }
    return out;
  }

  /**
   * The encoded ids of `$pull: { _id: { $in } }` (subdocument arrays only).
   *
   * @param _out - The update builder.
   * @param _ids - The ids to pull.
   * @throws {TypemoError} Always: an array of values has no `_id`.
   */
  protected pullIds(_out: DeltaBuilder, _ids: readonly unknown[]): unknown[] {
    throw new TypemoError("Internal error: $pull by _id on an array of values");
  }

  /**
   * Removes the given elements (identity), keeping the order of the rest.
   *
   * @param removed - The elements to remove.
   */
  protected removeElements(removed: readonly T[]): void {
    this.#removeAll(removed);
  }

  /* ---- internals ---- */

  /**
   * Fills a fresh array with hydrated items.
   *
   * @param items - The hydrated items (kept as the shadow when there is no store).
   */
  #fill(items: readonly T[]): void {
    const store = this.#store;
    if (store !== undefined) {
      store.push(...items);
      this.#sync(0);
      for (const item of items) Lineage.attach(item, this);
      return;
    }
    this.length = items.length;
    for (let index = 0; index < items.length; index++) this[index] = items[index] as T;
    if (!this.#scalar) for (const item of items) Lineage.attach(item, this);
    /* The shadow is the hydrated items array itself (the caller hands it over; no copy). */
    this.#shadow = items as unknown[];
  }

  /**
   * Updates the array's own indexes after a change of the store — accessors for the new positions, the length cut
   * for removed ones.
   *
   * @param before - The length the indexes had (the store's length before the change).
   */
  #sync(before: number): void {
    const length = (this.#store as T[]).length;
    for (let index = before; index < length; index++) Object.defineProperty(this, index, TrackedArray.#accessor(index));
    if (this.length !== length) this.length = length;
  }

  /**
   * A short array of objects that grew past {@link N1_THRESHOLD} through a method switches to access tracking. Its current
   * elements become the store (what the indexes show), and every one of them counts as accessed: an element changed
   * while the array was short is compared at save like one read after the switch. A write around the methods made
   * before the switch (found against the shadow) is kept and refused at save.
   */
  #trackIfLong(): void {
    if (this.#scalar || this.#store !== undefined || this.length <= N1_THRESHOLD) return;
    const problem = this.#directWrite();
    const store: T[] = [];
    for (let index = 0; index < this.length; index++) store.push(this[index] as T);
    const accessed = new Set<unknown>();
    for (const item of store) if (typeof item === "object" && item !== null) accessed.add(item);
    this.#store = store;
    this.#accessed = accessed;
    this.#written = problem;
    this.#shadow = [];
    this.#sync(0);
  }

  /**
   * Compares the length the indexes have with the store; a difference is a write around the methods (recorded).
   *
   * @returns The store's length.
   */
  #checkLength(): number {
    const store = this.#store as T[];
    if (this.length !== store.length) {
      this.#written ??= `its length is ${this.length} instead of ${store.length} (use push(), pop(), splice(), clear() or replace())`;
      this.length = 0;
      this.#sync(0);
    }
    return store.length;
  }

  /**
   * Links an element that entered through a method and marks it accessed (the caller holds it).
   *
   * @param item - The inserted element.
   */
  #inserted(item: unknown): void {
    Lineage.attach(item, this);
    this.markAccessed(item);
  }

  /**
   * Appends one element natively, to the shadow and (for objects) to the lineage.
   *
   * @param item - The element to append.
   */
  #append(item: T): void {
    Array.prototype.push.call(this, item);
    this.#shadow.push(item);
    if (!this.#scalar) Lineage.attach(item, this);
  }

  /**
   * Replaces the whole content without journaling.
   *
   * @param values - The new elements.
   */
  #rewrite(values: readonly T[]): void {
    const store = this.#store;
    if (store !== undefined) {
      const before = this.#checkLength();
      store.length = 0;
      store.push(...values);
      this.#sync(Math.min(before, values.length));
      return;
    }
    this.length = 0;
    for (let index = 0; index < values.length; index++) Array.prototype.push.call(this, values[index] as T);
    this.#shadow = [...values];
  }

  /**
   * Records the stored elements that a rewrite of the whole array (`splice`, `clear`, `replace`) drops: like an
   * element replaced by `set(i, v)`, their fields unknown to the schema would be lost silently, so the save
   * refuses them unless `dropUnknownFields` accepts the loss. Removals sent as their own operator (`pull`, `pop`,
   * `shift`) name exactly the element to delete and are not recorded.
   *
   * @param removed - The elements the operation removed.
   * @param from - The position of the first of them.
   */
  #recordDropped(removed: readonly T[], from: number): void {
    removed.forEach((item, offset) => {
      if (TrackedProtocol.is(item)) this.#journal.recordReplaced(from + offset, item);
    });
  }

  /**
   * Removes the given elements (identity) and releases them.
   *
   * @param removed - The elements to remove.
   */
  #removeAll(removed: readonly T[]): void {
    const gone = new Set<unknown>(removed);
    this.#rewrite(this.items().filter((item) => !gone.has(item)));
    for (const item of removed) this.#release(item);
  }

  /**
   * Detaches an element that left the array. An instance is never at two positions (an input already
   * attached is copied by the factory), so no search is needed; values that are not objects have no link.
   *
   * @param item - The element that left the array.
   */
  #release(item: unknown): void {
    if (typeof item === "object" && item !== null) {
      Lineage.detach(item);
      this.#accessed?.delete(item);
    }
  }

  /** The full path of the array in its document, for error messages. */
  #displayPath(): string {
    return Lineage.fullPath(this) ?? this.#node.path;
  }

  /**
   * What went around the methods, or `undefined`: for an array of values, an identity comparison with the shadow
   * (O(n)); for an array of objects, what the index setters recorded and the length (O(1)).
   */
  #directWrite(): string | undefined {
    const store = this.#store;
    if (store !== undefined) {
      if (this.#written !== undefined) return this.#written;
      return this.length === store.length
        ? undefined
        : `its length is ${this.length} instead of ${store.length} (use push(), pop(), splice(), clear() or replace())`;
    }
    const shadow = this.#shadow;
    if (this.length !== shadow.length) {
      return `its length is ${this.length} instead of ${shadow.length} (use push(), pop(), splice(), clear() or replace())`;
    }
    for (let index = 0; index < this.length; index++) {
      if (this[index] !== shadow[index]) return `position ${index} was assigned directly (use set(${index}, value))`;
    }
    return undefined;
  }

  /**
   * Refuses an operation that needs the complete array when it was loaded partially.
   *
   * @param at - The path of the array.
   * @param operation - The refused operation, for the message.
   * @throws {PartialArrayError} When the array was loaded by a projection.
   */
  #assertComplete(at: PathPair, operation: string): void {
    if (this.#partial) throw new PartialArrayError(at.code, operation);
  }
}
