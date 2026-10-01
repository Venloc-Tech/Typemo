/**
 * One populated field.
 *
 * @example
 * ```ts
 * const record: PopulatedRecord = { path: "author", original: id, hadOriginal: true, value: author, virtual: false };
 * ```
 */
export interface PopulatedRecord {
  /** The populate path from the root document that produced it (`author`, `lines.product`, `refs.$*`). */
  readonly path: string;
  /** The value the field held before populate (`undefined` for a virtual or an absent field). */
  readonly original: unknown;
  /** Whether the field had an own value before populate. */
  readonly hadOriginal: boolean;
  /** The populated value put in its place. */
  readonly value: unknown;
  /** A populate virtual: not stored data. */
  readonly virtual: boolean;
}

/**
 * A populated field of a root document, as its registry lists it.
 *
 * @example
 * ```ts
 * const [site] = PopulatedFields.sites(post); // { owner: post, key: "author", record }
 * ```
 */
export interface PopulatedSite {
  /** The root document or subdocument that owns the field. */
  readonly owner: object;
  /** The field key. */
  readonly key: string;
  /** The record of the populated field. */
  readonly record: PopulatedRecord;
}

/** The records of populated fields by owner and field key. */
const RECORDS = new WeakMap<object, Map<string, PopulatedRecord>>();

/**
 * The owners with records under each root document, in populate order.
 *
 * @example
 * ```ts
 * const sites: Sites = { list: [], seen: undefined };
 * ```
 */
interface Sites {
  /** The listed owner and key pairs. */
  readonly list: { owner: object; key: string }[];
  /** "Listed?" in O(1) once the list is long: a populate of many subdocuments would be quadratic. */
  seen: Map<object, Set<string>> | undefined;
}

/** The sites under each root document. */
const SITES = new WeakMap<object, Sites>();
/** Below this many sites a scan is cheaper than the index. */
const SCAN_LIMIT = 16;

/**
 * Adds `owner.key` to the sites of a root once.
 *
 * @param sites - The sites of the root.
 * @param owner - The owner of the field.
 * @param key - The field key.
 */
const listSite = (sites: Sites, owner: object, key: string): void => {
  if (sites.seen === undefined && sites.list.length < SCAN_LIMIT) {
    if (!sites.list.some((site) => site.owner === owner && site.key === key)) sites.list.push({ owner, key });
    return;
  }
  if (sites.seen === undefined) {
    const seen = new Map<object, Set<string>>();
    for (const site of sites.list) {
      const keys = seen.get(site.owner);
      if (keys === undefined) seen.set(site.owner, new Set([site.key]));
      else keys.add(site.key);
    }
    sites.seen = seen;
  }
  let keys = sites.seen.get(owner);
  if (keys === undefined) {
    keys = new Set();
    sites.seen.set(owner, keys);
  }
  if (keys.has(key)) return;
  keys.add(key);
  sites.list.push({ owner, key });
};

/**
 * Defines an own enumerable data property.
 *
 * @param target - The object to write to.
 * @param key - The property key.
 * @param value - The value.
 */
const define = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
};

/**
 * The registry of POPULATED fields of hydrated documents. A populated field holds the populated value (a
 * document, `null`, a read-only array or Map of documents, a number of a `count` virtual, transform
 * results) IN PLACE of its stored value; the stored value (the ids: a scalar, the tracked array or Map of
 * ids) is kept here. Everything that WRITES or compares stored data — change tracking, the delta of
 * `save`, validation, the plain form of a whole-array write — reads the stored value through
 * `PopulatedFields.stored`, so a populated field is never written back as documents and its ids are never
 * lost. Only `$toObject()`/`$toJSON()` and the user see the populated value.
 *
 * A record is keyed by the object that owns the field (the root document or a subdocument) and the field
 * key. It is valid while the field still holds the populated value: a field set to something else
 * (`$set`, a plain assignment) is an ordinary change again and its record is dropped.
 */
export class PopulatedFields {
  /**
   * Records that `owner[key]` (under `root`) now holds `record.value` in place of `record.original`, and
   * puts it there.
   *
   * @param root - The root document.
   * @param owner - The root or subdocument that owns the field.
   * @param key - The field key.
   * @param record - The record of the populated field.
   */
  static put(root: object, owner: object, key: string, record: PopulatedRecord): void {
    let records = RECORDS.get(owner);
    if (records === undefined) {
      records = new Map();
      RECORDS.set(owner, records);
    }
    records.set(key, record);
    let sites = SITES.get(root);
    if (sites === undefined) {
      sites = { list: [], seen: undefined };
      SITES.set(root, sites);
    }
    listSite(sites, owner, key);
    define(owner, key, record.value);
  }

  /**
   * The record of `owner[key]` while the field still holds the populated value.
   *
   * @param owner - The root or subdocument that owns the field.
   * @param key - The field key.
   * @returns The record, or `undefined` when the field is not populated any more.
   */
  static get(owner: object, key: string): PopulatedRecord | undefined {
    const record = RECORDS.get(owner)?.get(key);
    if (record === undefined) return undefined;
    if ((owner as Record<string, unknown>)[key] === record.value) return record;
    /* Replaced since: an ordinary value again. */
    RECORDS.get(owner)?.delete(key);
    return undefined;
  }

  /**
   * Whether `owner` has any populated field (a cheap test before the per-field lookups).
   *
   * @param owner - The root or subdocument to test.
   * @returns `true` when it has a record.
   */
  static has(owner: object): boolean {
    return (RECORDS.get(owner)?.size ?? 0) > 0;
  }

  /**
   * The STORED value of a field: its original value while it is populated, otherwise `current` itself.
   *
   * @param owner - The root or subdocument that owns the field.
   * @param key - The field key.
   * @param current - The value the field holds now.
   * @returns The stored value.
   */
  static stored(owner: object, key: string, current: unknown): unknown {
    if (current === undefined || !PopulatedFields.has(owner)) return current;
    const record = PopulatedFields.get(owner, key);
    return record === undefined || record.value !== current ? current : record.original;
  }

  /**
   * Whether `owner[key]` is a populate virtual holding its populated value (never stored data).
   *
   * @param owner - The root or subdocument that owns the field.
   * @param key - The field key.
   * @returns `true` for a populate virtual.
   */
  static isVirtual(owner: object, key: string): boolean {
    return PopulatedFields.get(owner, key)?.virtual === true;
  }

  /**
   * The populated fields under a root document (still populated), in populate order.
   *
   * @param root - The root document.
   * @returns The populated sites.
   */
  static sites(root: object): readonly PopulatedSite[] {
    const out: PopulatedSite[] = [];
    for (const site of SITES.get(root)?.list ?? []) {
      const record = PopulatedFields.get(site.owner, site.key);
      if (record !== undefined) out.push({ owner: site.owner, key: site.key, record });
    }
    return out;
  }

  /**
   * Puts the stored value back (a virtual becomes absent again) and forgets the record.
   *
   * @param owner - The root or subdocument that owns the field.
   * @param key - The field key.
   */
  static restore(owner: object, key: string): void {
    const record = PopulatedFields.get(owner, key);
    if (record === undefined) return;
    RECORDS.get(owner)?.delete(key);
    if (record.hadOriginal) define(owner, key, record.original);
    else delete (owner as Record<string, unknown>)[key];
  }
}
