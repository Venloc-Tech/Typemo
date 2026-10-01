import { BsonGuards } from "../bson/bson-guards.ts";
import { Subdocuments } from "../document/collections/subdocument.ts";
import { DocumentStates } from "../document/document-state.ts";
import { PopulatedFields } from "../document/populated-fields.ts";
import { DocumentNotFoundError } from "../errors/document-not-found-error.ts";
import { QueryError } from "../errors/query-error.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import type { VirtualOptions } from "../schema/options/virtual-options.ts";
import type { Population } from "./populate-planner.ts";
import { PopulatedArray, PopulatedMap, PopulateKeys } from "./populated-values.ts";

/**
 * One stored reference to resolve: one id, an array of ids, or (a Map) one of its entries.
 *
 * @example
 * ```ts
 * const slot: Slot = { key: undefined, many: true, locals: [id1, id2] };
 * ```
 */
export interface Slot {
  /** The Map key of an entry of a Map of references; `undefined` otherwise. */
  readonly key: string | undefined;
  /** An array of ids (or a virtual's local values). */
  readonly many: boolean;
  /** The local values (ids), in stored order; `null` elements kept. */
  readonly locals: readonly unknown[];
}

/**
 * A reference field on one owner (the document or a subdocument that holds it).
 *
 * @example
 * ```ts
 * const site = PopulateAssigner.site(owner, population, { lean: false }, "");
 * site?.slots.length;
 * ```
 */
export interface Site {
  /** The object that holds the field, its schema and the root document. */
  readonly owner: { readonly object: Record<string, unknown>; readonly schema: CompiledSchema; readonly root: object };
  /** The key of the field (or virtual) on the owner. */
  readonly key: string;
  /** The populate path shown in messages and recorded for `$populated`. */
  readonly path: string;
  /** The reference node (the element of an array, the value of a Map); `undefined` for a virtual. */
  readonly node: PathNode | undefined;
  /** The options of the populate virtual; `undefined` for a reference field. */
  readonly virtual: VirtualOptions | undefined;
  /** The stored value (ids) before populating. */
  readonly stored: unknown;
  /** Whether the owner had the field set before populating. */
  readonly hadOriginal: boolean;
  /** `true` for a Map of references. */
  readonly map: boolean;
  /** The references to resolve on this site. */
  readonly slots: readonly Slot[];
}

/**
 * What the executor found for one slot.
 *
 * @example
 * ```ts
 * const found: SlotResults = { byKey: (id) => docs.get(id), all: () => [...docs.values()], count: 0 };
 * ```
 */
export interface SlotResults {
  /** The document of one id (a reference). */
  readonly byKey: (value: unknown) => object | undefined;
  /** The documents of the slot in result order (a virtual). */
  readonly all: () => readonly object[];
  /** The count of a `count` virtual. */
  readonly count: number;
}

/** A plain document-like record. */
type Doc = Record<string, unknown>;

/**
 * Unwraps arrays (a reference array's element carries the reference).
 *
 * @param node - The path node.
 * @returns The innermost non-array node.
 */
const elementOf = (node: PathNode): PathNode => (node.kind === "array" ? elementOf(node.element) : node);

/**
 * Sites and assignment of populated values. What a populated field holds:
 *
 * | reference                      | found         | not found / not matched                                  |
 * |--------------------------------|---------------|----------------------------------------------------------|
 * | single `Ref<M>`                | the document  | `null` (typed `\| null`; `required: true` removes it)     |
 * | array `Ref<M>[]`               | the documents | left out of the populated VIEW; `retainNullValues`: `null` in place |
 * | Map `Map<string, Ref<M>>`      | per key       | `null` per key                                           |
 * | virtual (many / `justOne`)     | the documents | `[]` / `null`                                            |
 * | `count` virtual                | the number    | `0`                                                      |
 * | `transform(doc, id)`           | its result for every id (`doc` is `null` when not found; positions kept) |
 * | `required: true`               | as above      | `DocumentNotFoundError` (a stored `null` is not a reference) |
 *
 * The STORED ids are never touched: on a hydrated document the populated value is put in place and the ids
 * stay behind it (`PopulatedFields`), so `save()` writes the ids, never the documents, and never loses the
 * ids that found nothing (Mongoose M8 finding #1 dropped them). A `null` or absent reference is left as
 * it is. On a hydrated document arrays and Maps of documents are read-only views; lean results get plain
 * arrays and records. A document found for several owners is the same object in each (no copy).
 *
 * @example
 * ```ts
 * const site = PopulateAssigner.site(owner, population, { lean: false }, "");
 * if (site !== undefined) PopulateAssigner.assign([site], population, resultsOf);
 * ```
 */
export class PopulateAssigner {
  /**
   * The site of `owner` for a population.
   *
   * @param owner - The object that holds the reference field.
   * @param population - The planned population.
   * @param run - The run settings; only `lean` matters here.
   * @param prefix - The path of `owner` from the root populate.
   * @returns The site, or `undefined` when there is nothing to populate there.
   * @throws {QueryError} If a hydrated owner did not select the local field of a populate virtual.
   */
  static site(
    owner: Site["owner"],
    population: Population,
    run: { readonly lean: boolean },
    prefix: string,
  ): Site | undefined {
    const path = `${prefix}${population.path}`;
    const object = owner.object;
    /* Populating a populated field again replaces it: the stored ids come back first (re-populate). */
    if (!run.lean) PopulatedFields.restore(object, population.field);
    const hadOriginal = Object.hasOwn(object, population.field) && object[population.field] !== undefined;
    const stored = hadOriginal ? object[population.field] : undefined;
    if (population.source.kind === "virtual") {
      const name = population.source.virtual;
      const definition = owner.schema.virtuals.find((one) => one.kind === "populate" && one.key === name);
      if (definition === undefined || definition.kind !== "populate") return undefined;
      const options = definition.options;
      PopulateAssigner.requireSelected(owner, options.localField, path);
      const local = PopulateAssigner.local(object, options.localField);
      const locals = Array.isArray(local)
        ? [...(local as readonly unknown[])]
        : local === null || local === undefined
          ? []
          : [local];
      return {
        owner,
        key: population.field,
        path,
        node: undefined,
        virtual: options,
        stored,
        hadOriginal,
        map: false,
        slots: [{ key: undefined, many: true, locals }],
      };
    }
    const node = owner.schema.field(population.field);
    if (node === undefined || stored === null || stored === undefined) return undefined;
    if (population.map) {
      if (node.kind !== "map") return undefined;
      const entries: [string, unknown][] = BsonGuards.isMap(stored)
        ? [...stored].map(([key, value]): [string, unknown] => [String(key), value])
        : BsonGuards.isPlainObject(stored)
          ? Object.entries(stored)
          : [];
      return {
        owner,
        key: population.field,
        path,
        node: elementOf(node.value),
        virtual: undefined,
        stored,
        hadOriginal,
        map: true,
        slots: entries.map(([key, value]) => PopulateAssigner.slot(key, value)),
      };
    }
    return {
      owner,
      key: population.field,
      path,
      node: elementOf(node),
      virtual: undefined,
      stored,
      hadOriginal,
      map: false,
      slots: [PopulateAssigner.slot(undefined, stored)],
    };
  }

  /**
   * Builds the slot of one stored value.
   *
   * @param key - The Map key, or `undefined`.
   * @param value - The stored id or array of ids.
   * @returns The slot.
   */
  private static slot(key: string | undefined, value: unknown): Slot {
    return Array.isArray(value)
      ? { key, many: true, locals: [...(value as readonly unknown[])] }
      : { key, many: false, locals: value === null || value === undefined ? [] : [value] };
  }

  /**
   * The local value of a virtual (a populated local field gives its stored ids).
   *
   * @param object - The owner object.
   * @param path - The dotted local field path.
   * @returns The local value, or `undefined`.
   */
  private static local(object: Doc, path: string): unknown {
    const [head, ...rest] = path.split(".") as [string, ...string[]];
    let value: unknown = PopulatedFields.stored(object, head, object[head]);
    for (const segment of rest) {
      if (value === null || typeof value !== "object") return undefined;
      value = BsonGuards.isMap(value) ? value.get(segment) : (value as Doc)[segment];
    }
    return value;
  }

  /**
   * A hydrated document that did not load the local field of a virtual cannot be populated (never a silent `[]`).
   *
   * @param owner - The owner of the virtual.
   * @param localField - The virtual's local field.
   * @param path - The populate path for the error message.
   * @throws {QueryError} If the local field was not selected.
   */
  private static requireSelected(owner: Site["owner"], localField: string, path: string): void {
    if (!DocumentStates.is(owner.object)) return;
    const state = DocumentStates.of(owner.object);
    const head = localField.split(".")[0] as string;
    if (!DocumentStates.isSelected(state, head)) {
      throw new QueryError(`populate "${path}": its localField "${localField}" was not selected; select it too`, {
        path,
      });
    }
  }

  /**
   * Puts the populated values into their owners.
   *
   * @param sites - The sites to fill.
   * @param population - The planned population.
   * @param results - Returns what the executor found for a site's slot.
   * @throws {DocumentNotFoundError} If `required` is set and a reference found nothing.
   */
  static assign(
    sites: readonly Site[],
    population: Population,
    results: (site: Site, slot: Slot) => SlotResults,
  ): void {
    for (const site of sites) {
      const hydrated = DocumentStates.is(site.owner.object) || Subdocuments.isSubdocument(site.owner.object);
      let value: unknown;
      if (site.map) {
        const entries = site.slots.map((slot): [string, unknown] => [
          slot.key as string,
          PopulateAssigner.reference(slot, population, results(site, slot), hydrated),
        ]);
        value = hydrated ? PopulatedMap.from(entries) : PopulateAssigner.record(entries);
      } else {
        const slot = site.slots[0] as Slot;
        value =
          site.virtual !== undefined
            ? PopulateAssigner.virtual(site, slot, population, results(site, slot), hydrated)
            : PopulateAssigner.reference(slot, population, results(site, slot), hydrated);
      }
      if (!hydrated) {
        Object.defineProperty(site.owner.object, site.key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        continue;
      }
      PopulatedFields.put(site.owner.root, site.owner.object, site.key, {
        path: site.path,
        original: site.stored,
        hadOriginal: site.hadOriginal,
        value,
        virtual: site.virtual !== undefined,
      });
    }
  }

  /**
   * The populated value of a reference slot (one id or an array of ids).
   *
   * @param slot - The slot.
   * @param population - The planned population.
   * @param found - What the executor found.
   * @param hydrated - Whether the owner is hydrated (read-only views) or lean (plain values).
   * @returns The document, a list, or `null`.
   * @throws {DocumentNotFoundError} If `required` is set and a reference found nothing.
   */
  private static reference(slot: Slot, population: Population, found: SlotResults, hydrated: boolean): unknown {
    const transform = population.transform as ((doc: object | null, id: unknown) => unknown) | undefined;
    if (!slot.many) {
      const id = slot.locals[0];
      /* A null entry of a Map. */
      if (id === undefined) return null;
      const doc = found.byKey(id) ?? null;
      if (doc === null && population.required) PopulateAssigner.missing(population, id);
      const one = transform === undefined ? doc : transform(doc, id);
      if (population.justOne !== false) return one;
      if (transform === undefined && doc === null && !population.retainNullValues)
        return PopulateAssigner.list([], hydrated);
      return PopulateAssigner.list([one], hydrated);
    }
    let entries: { readonly id: unknown; readonly doc: object | null }[] = slot.locals.map((id) => ({
      id,
      doc: id === null || id === undefined ? null : (found.byKey(id) ?? null),
    }));
    if (population.required) {
      const missing = entries.find((entry) => entry.doc === null && entry.id !== null && entry.id !== undefined);
      if (missing !== undefined) PopulateAssigner.missing(population, missing.id);
    }
    if (population.sort !== undefined) {
      /* In the order of the query's sort (positions are not kept: retainNullValues is refused with sort). */
      const all = found.all();
      const rank = new Map(all.map((doc, index) => [doc, index] as const));
      entries = entries
        .filter((entry) => entry.doc !== null)
        .sort((a, b) => (rank.get(a.doc as object) ?? 0) - (rank.get(b.doc as object) ?? 0));
    } else if (!population.retainNullValues && transform === undefined) {
      entries = entries.filter((entry) => entry.doc !== null);
    }
    const start = population.skip ?? 0;
    entries = entries.slice(start, population.limit === undefined ? undefined : start + population.limit);
    const values = entries.map((entry) => (transform === undefined ? entry.doc : transform(entry.doc, entry.id)));
    if (population.justOne === true) {
      const first = entries[0];
      if (transform !== undefined) return first === undefined ? transform(null, slot.locals[0]) : values[0];
      return values[0] ?? null;
    }
    return PopulateAssigner.list(values, hydrated);
  }

  /**
   * The populated value of a virtual: the documents, one of them, or their number.
   *
   * @param site - The virtual's site.
   * @param slot - The slot with the local values.
   * @param population - The planned population.
   * @param found - What the executor found.
   * @param hydrated - Whether the owner is hydrated.
   * @returns A count, a document (or `null`), or a list.
   * @throws {DocumentNotFoundError} If `required` is set and a `justOne` virtual found nothing.
   */
  private static virtual(
    site: Site,
    slot: Slot,
    population: Population,
    found: SlotResults,
    hydrated: boolean,
  ): unknown {
    if (population.count) return found.count;
    const options = site.virtual as VirtualOptions;
    const justOne = population.justOne ?? options.justOne === true;
    /* The query applied the per-owner sort/skip/limit already (a find for one owner, a $lookup for several). */
    const docs = found.all();
    const transform = population.transform as ((doc: object | null, id: unknown) => unknown) | undefined;
    const localOf = (doc: object | null): unknown => PopulateAssigner.matchedLocal(doc, slot, options.foreignField);
    if (justOne) {
      const doc = docs[0] ?? null;
      if (doc === null && population.required) PopulateAssigner.missing(population, slot.locals[0]);
      return transform === undefined ? doc : transform(doc, localOf(doc));
    }
    return PopulateAssigner.list(
      transform === undefined ? docs : docs.map((doc) => transform(doc, localOf(doc))),
      hydrated,
    );
  }

  /**
   * The local value a virtual's document was found by (the transform's `id`).
   *
   * @param doc - The found document, or `null`.
   * @param slot - The slot with the local values.
   * @param foreignField - The virtual's foreign field path.
   * @returns The matching local value (the first one when none matches).
   */
  private static matchedLocal(doc: object | null, slot: Slot, foreignField: string): unknown {
    if (doc === null) return slot.locals[0];
    const keys = new Set(PopulateAssigner.values(doc, foreignField.split(".")).map((value) => PopulateKeys.of(value)));
    return slot.locals.find((value) => keys.has(PopulateKeys.of(value))) ?? slot.locals[0];
  }

  /**
   * Collects the values at a dotted path, going through arrays and Maps.
   *
   * @param value - The value to walk.
   * @param segments - The remaining path segments.
   * @returns Every value found at the path.
   */
  private static values(value: unknown, segments: readonly string[]): unknown[] {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap((item: unknown) => PopulateAssigner.values(item, segments));
    if (segments.length === 0) return [value];
    if (typeof value !== "object" || BsonGuards.isBsonValue(value)) return [];
    const [head, ...rest] = segments as [string, ...string[]];
    return PopulateAssigner.values(BsonGuards.isMap(value) ? value.get(head) : (value as Doc)[head], rest);
  }

  /**
   * Fails for a required reference that found nothing.
   *
   * @param population - The planned population.
   * @param id - The reference that found nothing.
   * @throws {DocumentNotFoundError} Always.
   */
  private static missing(population: Population, id: unknown): never {
    throw new DocumentNotFoundError(
      `populate("${population.path}")`,
      population.path,
      `populate "${population.path}": no document for the reference ${String(id)} (required: true)`,
    );
  }

  /**
   * A frozen populated array for a hydrated owner, a plain copy for a lean one.
   *
   * @param values - The values.
   * @param hydrated - Whether the owner is hydrated.
   * @returns The array.
   */
  private static list(values: readonly unknown[], hydrated: boolean): unknown {
    return hydrated ? PopulatedArray.freeze(values) : [...values];
  }

  /**
   * A plain record of the entries; own data properties, so a key like `__proto__` stays a key.
   *
   * @param entries - Key and value pairs.
   * @returns The record.
   */
  private static record(entries: readonly (readonly [string, unknown])[]): Doc {
    const out: Doc = {};
    for (const [key, value] of entries) {
      Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
}
