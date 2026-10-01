import { TypemoError } from "../../errors/typemo-error.ts";
import type { ArrayNode, PathNode } from "../../schema/compiler/path-node.ts";
import type { Plain } from "../../types/document-forms.ts";
import type { ObjectDoc, SUBDOCUMENT_ELEMENT, Subdocument, SubdocumentId, SubdocumentInput } from "./hydrated-types.ts";
import { Lineage } from "./lineage.ts";
import { TrackedArray } from "./strict-array.ts";
import type { PlainFormOptions, TrackedFactory } from "./tracked-protocol.ts";
import type { DeltaBuilder } from "./update-ops.ts";
import { ValueEquality } from "./value-equality.ts";

/**
 * An array of subdocuments (Mongoose `DocumentArray`). Same strict rules as `StrictArray` — no index
 * or `length` writes, mutations through methods, one journal, the shadow check at save — plus:
 * - `create(input)`: a detached subdocument of the element class (embedded discriminators resolved by
 *   the discriminator VALUE); `push`/`unshift`/`set`/`splice`/`replace` accept subdocuments,
 *   instances of the class or create input, all cast at once (`CastError`);
 * - `id(id)`: the element by `_id`, the argument cast by the `_id` type of the element schema (a string id finds
 *   an `ObjectId` element).
 *   Exists in the type only when the element class has `_id`;
 * - `pull(...)`: by subdocument or by id; `$pull: { path: { _id: { $in: [...] } } }`.
 * Field changes inside elements become `$set: { "path.i.field": v }`, the index computed at save (so an element
 * that moved after the change is still written at its current position).
 *
 * @example
 * ```ts
 * const order = await Orders.findOne({}).orFail();
 * const line = order.lines.create({ sku: "A1", qty: 2 });
 * order.lines.push(line);
 * order.lines.id(line._id)?.qty; // 2
 * order.lines.pull(line._id); // saved as { $pull: { lines: { _id: { $in: [line._id] } } } }
 * ```
 */
export interface SubdocumentArray<T> extends ReadonlyArray<Subdocument<T>> {
  /** Phantom (type only): the subdocument class, for `ElementInput`. */
  readonly [SUBDOCUMENT_ELEMENT]: T;
  /**
   * A new, detached subdocument (attach it with `push`, `unshift`, `set`, …).
   *
   * @param input - A subdocument, an instance of the class, or create input.
   * @throws {CastError} When the input cannot be cast.
   */
  create(input: SubdocumentInput<T>): Subdocument<T>;
  /**
   * The element with this `_id` (compared with `equals`), `undefined` when absent.
   *
   * @param id - The `_id`, cast by the `_id` type of the element schema.
   */
  id(this: SubdocumentArray<T & { readonly _id: unknown }>, id: SubdocumentId<T>): Subdocument<T> | undefined;
  /**
   * Appends the items, tracked as `$push`.
   *
   * @param items - Subdocuments, instances of the class, or create input.
   * @returns The new length.
   * @throws {CastError} When an item cannot be cast.
   */
  push(...items: SubdocumentInput<T>[]): number;
  /**
   * Appends the items not yet present (compared by value: `_id` included when the class has one); `$addToSet`.
   *
   * @param items - Subdocuments, instances of the class, or create input.
   * @returns The elements that were added.
   * @throws {CastError} When an item cannot be cast.
   */
  addToSet(...items: SubdocumentInput<T>[]): Subdocument<T>[];
  /**
   * Prepends the items, tracked as `$push` with `$position: 0`.
   *
   * @param items - Subdocuments, instances of the class, or create input.
   * @returns The new length.
   * @throws {CastError} When an item cannot be cast.
   */
  unshift(...items: SubdocumentInput<T>[]): number;
  /**
   * Removes elements given as subdocuments or ids; `$pull` by `_id`.
   *
   * @param items - Subdocuments of this array, or their ids.
   * @returns The elements that were removed.
   * @throws {TypemoError} When ids are given but the elements have no `_id`.
   */
  pull(...items: (Subdocument<T> | SubdocumentId<T>)[]): Subdocument<T>[];
  /** Removes the last element; `$pop: 1`. */
  pop(): Subdocument<T> | undefined;
  /** Removes the first element; `$pop: -1`. */
  shift(): Subdocument<T> | undefined;
  /**
   * As `Array#splice`; rewrites the whole array at save.
   * A dropped stored element with fields unknown to the schema makes the save throw `UnknownFieldsError`
   * unless `dropUnknownFields: true` accepts the loss.
   *
   * @param start - The index to start at (negative counts from the end).
   * @param deleteCount - How many elements to remove; absent removes to the end.
   * @param items - The elements to insert.
   * @returns The removed elements.
   * @throws {CastError} When an item cannot be cast.
   */
  splice(start: number, deleteCount?: number, ...items: SubdocumentInput<T>[]): Subdocument<T>[];
  /**
   * Sorts in place; rewrites the whole array at save.
   *
   * @param compare - The comparison function, as for `Array#sort`.
   * @returns This array.
   */
  sort(compare?: (a: Subdocument<T>, b: Subdocument<T>) => number): this;
  /**
   * Reverses in place; rewrites the whole array at save.
   *
   * @returns This array.
   */
  reverse(): this;
  /**
   * Replaces the element at an existing position; `$set: { "path.index": value }`.
   *
   * @param index - An existing position.
   * @param value - A subdocument, an instance of the class, or create input.
   * @returns This array.
   * @throws {TypemoError} When the index is not an existing position.
   * @throws {CastError} When the value cannot be cast.
   */
  set(index: number, value: SubdocumentInput<T>): this;
  /**
   * Removes every element; `$set: { path: [] }`.
   * A dropped stored element with fields unknown to the schema makes the save throw `UnknownFieldsError`
   * unless `dropUnknownFields: true` accepts the loss.
   *
   * @returns This array.
   */
  clear(): this;
  /**
   * Replaces the whole content; `$set` of the whole array.
   * A dropped stored element with fields unknown to the schema makes the save throw `UnknownFieldsError`
   * unless `dropUnknownFields: true` accepts the loss.
   *
   * @param values - The new elements.
   * @returns This array.
   * @throws {CastError} When a value cannot be cast.
   */
  replace(values: readonly SubdocumentInput<T>[]): this;
  /** The object form: untracked copies of the elements. */
  $toObject(): ObjectDoc<T>[];
  /**
   * The plain form: exactly what the document's `$toPlain()` gives at this path — ids, int64,
   * `Decimal128`, `UUID` as strings, `Date`/`RegExp`/`Map` kept; `Hidden` fields of subdocuments out unless
   * `{ hidden: true }`.
   *
   * @param options - Plain-form options.
   */
  $toPlain(options?: PlainFormOptions & { readonly hidden?: false }): Plain<T, false>[];
  /**
   * The plain form with the `Hidden` fields of subdocuments included.
   *
   * @param options - Plain-form options with `hidden: true`.
   */
  $toPlain(options: PlainFormOptions & { readonly hidden: true }): Plain<T, true>[];
}

/** The runtime of {@link SubdocumentArray}. */
export class TrackedSubdocumentArray<T extends object> extends TrackedArray<T> {
  /* `constructor.name` shows the public type (`SubdocumentArray`), not the name of the runtime class: the interface of that name shares this file. `this`, not the class name: the compiled output aliases the class name to a variable that is assigned only after the static blocks have run. */
  static {
    // biome-ignore lint/complexity/noThisInStatic: the class name is not yet bound in the compiled static block (see the comment above).
    Object.defineProperty(this, "name", { value: "SubdocumentArray", configurable: true });
  }

  /**
   * A tracked subdocument array of `node` holding `items` (already hydrated).
   *
   * @param node - The schema node of the array.
   * @param items - The hydrated subdocuments.
   * @param factory - Creates tracked values from input.
   * @param partial - Whether the array was loaded by a projection.
   */
  static createFor<E extends object>(
    node: ArrayNode,
    items: readonly E[],
    factory: TrackedFactory,
    partial: boolean,
  ): TrackedSubdocumentArray<E> {
    return TrackedArray.init(
      new TrackedSubdocumentArray<E>(),
      node,
      items,
      factory,
      partial,
    ) as TrackedSubdocumentArray<E>;
  }

  /**
   * A new, detached subdocument cast from `input`.
   *
   * @param input - A subdocument, an instance of the class, or create input.
   * @throws {CastError} When the input cannot be cast.
   */
  create(input: unknown): T {
    return this.castItems([input], this.length)[0] as T;
  }

  /**
   * The element with this `_id`, `undefined` when absent.
   *
   * @param id - The `_id`, cast by the `_id` type of the element schema.
   * @throws {TypemoError} When the elements have no `_id`.
   */
  id(id: unknown): T | undefined {
    const wanted = this.#castId(id);
    /* The core scans without marking; only the element handed back is accessed. */
    const found = this.items().find((item) => ValueEquality.equals((item as { _id?: unknown })._id, wanted));
    this.markAccessed(found);
    return found;
  }

  /**
   * Removes elements given as subdocuments (by identity) or ids; journals a `$pull` by `_id`, or the whole
   * array when a removed element has no `_id`.
   *
   * @param items - Subdocuments of this array, or their ids.
   * @returns The elements that were removed.
   * @throws {TypemoError} When ids are given but the elements have no `_id`.
   */
  override pull(...items: unknown[]): T[] {
    const ids: unknown[] = [];
    const instances: unknown[] = [];
    for (const item of items) {
      if (typeof item === "object" && item !== null && Lineage.isEmbedded(item)) instances.push(item);
      else ids.push(this.#castId(item));
    }
    const removed = this.items().filter(
      (element) => instances.includes(element) || ValueEquality.isAmong((element as { _id?: unknown })._id, ids),
    );
    if (removed.length === 0) return [];
    this.removeElements(removed);
    const removedIds = removed.map((element) => (element as { _id?: unknown })._id);
    /* Without an `_id` on every removed element there is no `$pull` condition that names exactly them. */
    if (removedIds.every((id) => id !== undefined && id !== null)) this.journal.record("$pullIds", removedIds);
    else this.journal.markWhole();
    return removed;
  }

  /**
   * The encoded ids of `$pull: { _id: { $in } }`.
   *
   * @param out - The update builder.
   * @param ids - The ids to pull.
   * @throws {TypemoError} When the elements have no `_id`.
   */
  protected override pullIds(out: DeltaBuilder, ids: readonly unknown[]): unknown[] {
    const idNode = this.#idNode();
    return ids.map((id) => out.value(idNode, id));
  }

  /**
   * The schema node of the elements' `_id`.
   *
   * @throws {TypemoError} When the elements have no `_id`.
   */
  #idNode(): PathNode {
    const element = this.elementNode;
    const node = element.kind === "subdocument" || element.kind === "nested" ? element.schema.field("_id") : undefined;
    if (node === undefined) {
      throw new TypemoError(`The elements of this subdocument array have no _id: use a subdocument, not an id`);
    }
    return node;
  }

  /**
   * Casts an id by the `_id` type of the element schema.
   *
   * @param id - The id to cast.
   * @throws {TypemoError} When the elements have no `_id`.
   */
  #castId(id: unknown): unknown {
    return this.#idNode().caster.cast(id, "_id");
  }
}
