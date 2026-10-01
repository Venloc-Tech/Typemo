import type { Db, Document } from "mongodb";
import type { Outcome } from "./types.ts";

/**
 * Anything that may be a BSON value: BSON classes carry a `_bsontype` tag.
 *
 * @example
 * ```ts
 * const tagged: Bsonish = { _bsontype: "ObjectId" };
 * ```
 */
type Bsonish = { readonly _bsontype?: string };

/** Matches a canonical UUID string. */
const UUID_STRING = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Converts whatever a contestant returned into plain data: Mongoose documents via `toObject`, Typemo documents
 * via `$toObject`, everything else as is. Duck-typed, so one call works for every contestant.
 */
export class Plain {
  /**
   * The plain data of one value.
   *
   * @param value - A document of any contestant, or plain data.
   * @returns The plain form.
   */
  static of(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    const candidate = value as {
      readonly $toObject?: () => unknown;
      readonly toObject?: (options: Record<string, unknown>) => unknown;
      readonly $__?: unknown;
    };
    if (typeof candidate.$toObject === "function") return candidate.$toObject();
    if (candidate.$__ !== undefined && typeof candidate.toObject === "function") {
      return candidate.toObject({ depopulate: true, virtuals: false, getters: false, flattenMaps: false });
    }
    return value;
  }

  /**
   * The plain data of every value.
   *
   * @param values - Documents of any contestant, or plain data.
   * @returns The plain forms, in order.
   */
  static all(values: readonly unknown[]): unknown[] {
    return values.map(Plain.of);
  }
}

/**
 * A canonical, contestant-independent form of data: keys sorted, `undefined` dropped, BSON values tagged by
 * kind (ObjectId → `oid:hex`, int64/bigint → `long:n`, Binary/Buffer → `bin:base64`, Map → record, …).
 * Two contestants that produced the same data have equal canonical forms regardless of their document classes.
 */
export class Canonical {
  /**
   * The canonical form of a value.
   *
   * @param value - Any value.
   * @returns JSON-compatible data with sorted keys and tagged BSON values.
   */
  static of(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    switch (typeof value) {
      case "number":
        return Object.is(value, -0) ? 0 : value;
      case "bigint":
        return `long:${value.toString()}`;
      case "string":
        return UUID_STRING.test(value) ? `uuid:${value.replaceAll("-", "").toLowerCase()}` : value;
      case "boolean":
        return value;
      case "function":
      case "symbol":
        return null;
    }
    if (value instanceof Date) return `date:${Number.isNaN(value.getTime()) ? "invalid" : value.toISOString()}`;
    if (value instanceof RegExp) return `re:/${value.source}/${[...value.flags].sort().join("")}`;
    if (value instanceof Map) {
      const record: Record<string, unknown> = {};
      for (const [k, v] of value) record[String(k)] = v;
      return Canonical.object(record);
    }
    if (Array.isArray(value)) return value.map(Canonical.of);
    if (value instanceof Uint8Array) return `bin:${Buffer.from(value).toString("base64")}`;
    const tagged = Canonical.bson(value as Bsonish & Record<string, unknown>);
    if (tagged !== undefined) return tagged;
    return Canonical.object(value as Record<string, unknown>);
  }

  /**
   * The tagged form of a BSON value.
   *
   * @param value - A candidate BSON value.
   * @returns The tag string or number, or `undefined` when the value is not BSON.
   */
  private static bson(value: Bsonish & Record<string, unknown>): unknown {
    const call = (name: string): unknown => {
      const fn = value[name];
      return typeof fn === "function" ? (fn as () => unknown).call(value) : undefined;
    };
    switch (value._bsontype) {
      case "ObjectId":
        return `oid:${String(call("toHexString"))}`;
      case "Long":
        return `long:${String(call("toString"))}`;
      case "Int32":
      case "Double":
        return Number(call("valueOf"));
      case "Decimal128":
        return `dec:${String(call("toString"))}`;
      case "Timestamp":
        return `ts:${String(value.high)}:${String(value.low)}`;
      case "BSONRegExp":
        return `re:/${String(value.pattern)}/${[...String(value.options)].sort().join("")}`;
      case "MinKey":
      case "MaxKey":
        return value._bsontype;
      case "Binary": {
        const bytes = value.buffer as Uint8Array;
        const sub = value.sub_type as number;
        if (sub === 4) return `uuid:${Buffer.from(bytes.subarray(0, value.position as number)).toString("hex")}`;
        return `bin:${Buffer.from(bytes.subarray(0, value.position as number)).toString("base64")}`;
      }
      default:
        return undefined;
    }
  }

  /**
   * The canonical form of a plain object: sorted keys, `undefined` dropped.
   *
   * @param value - A plain object.
   * @returns The canonical object.
   */
  private static object(value: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v !== undefined) out[key] = Canonical.of(v);
    }
    return out;
  }
}

/** Checksums of canonical data. */
export class Checksum {
  /**
   * 64-bit hash (hex) of the canonical form.
   *
   * @param value - Any value.
   * @returns The hash.
   */
  static of(value: unknown): string {
    return Bun.hash(JSON.stringify(Canonical.of(value))).toString(16);
  }

  /**
   * Order-insensitive checksum of a list (sorted canonical strings).
   *
   * @param values - The list.
   * @returns The hash.
   */
  static unordered(values: readonly unknown[]): string {
    return Bun.hash(
      values
        .map((v) => JSON.stringify(Canonical.of(v)))
        .sort()
        .join("\n"),
    ).toString(16);
  }
}

/**
 * Options of `Outcomes.docs` and `Outcomes.doc`.
 *
 * @example
 * ```ts
 * const options: DocsOutcomeOptions = { omit: ["_id"], unordered: true };
 * ```
 */
export interface DocsOutcomeOptions {
  /** Compare only these top-level fields (e.g. when contestants legitimately differ elsewhere). */
  readonly fields?: readonly string[];
  /** Ignore the order of the documents. */
  readonly unordered?: boolean;
  /** Drop these top-level fields before hashing (e.g. generated `_id`s, timestamps). */
  readonly omit?: readonly string[];
}

/**
 * Options of `Outcomes.state` and `Outcomes.stateOf`.
 *
 * @example
 * ```ts
 * const options: StateOptions = { volatile: ["updatedAt"], omit: ["_id"] };
 * ```
 */
export interface StateOptions {
  /** Top-level fields whose VALUE is volatile (timestamps): replaced by their type tag, presence still checked. */
  readonly volatile?: readonly string[];
  /** Top-level fields dropped entirely (e.g. generated `_id`). With `_id` omitted, documents are sorted canonically. */
  readonly omit?: readonly string[];
  /** Only documents matching this filter are fingerprinted. */
  readonly filter?: Document;
  /** Only these top-level fields (a projection): for collections other scenarios also modify. */
  readonly fields?: readonly string[];
}

/**
 * Reduces a document to the fields that are compared.
 *
 * @param doc - A document of any contestant.
 * @param options - Which fields to keep or drop.
 * @returns The plain, reduced document; non-objects are returned as they are.
 */
const pickFields = (doc: unknown, options: DocsOutcomeOptions): unknown => {
  const plain = Plain.of(doc);
  if (plain === null || typeof plain !== "object" || Array.isArray(plain)) return plain;
  const source = plain as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const keys = options.fields ?? Object.keys(source);
  for (const key of keys) {
    if (options.omit?.includes(key)) continue;
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
};

/**
 * A tag for the type of a volatile value.
 *
 * @param value - Any value.
 * @returns For example `<date>`, `<array>` or `<string>`.
 */
const typeTag = (value: unknown): string =>
  value === null ? "null" : value instanceof Date ? "<date>" : Array.isArray(value) ? "<array>" : `<${typeof value}>`;

/** Builders of `Outcome`s. */
export class Outcomes {
  /**
   * An outcome that compares only a count.
   *
   * @param count - The number of documents or results.
   * @returns The outcome.
   */
  static count(count: number): Outcome {
    return { count, checksum: "" };
  }

  /**
   * An outcome that compares a value.
   *
   * @param value - Any value.
   * @param count - The count to report.
   * @returns The outcome.
   */
  static value(value: unknown, count = 1): Outcome {
    return { count, checksum: Checksum.of(value) };
  }

  /**
   * An outcome that compares a list of documents.
   *
   * @param docs - The documents; `null` or `undefined` count as none.
   * @param options - Which fields to compare and whether the order matters.
   * @returns The outcome.
   */
  static docs(docs: readonly unknown[] | null | undefined, options: DocsOutcomeOptions = {}): Outcome {
    const list = docs ?? [];
    const picked = list.map((doc) => pickFields(doc, options));
    return {
      count: list.length,
      checksum: options.unordered === true ? Checksum.unordered(picked) : Checksum.of(picked),
    };
  }

  /**
   * An outcome that compares one document.
   *
   * @param doc - The document; `null` or `undefined` count as none.
   * @param options - Which fields to compare.
   * @returns The outcome.
   */
  static doc(doc: unknown, options: DocsOutcomeOptions = {}): Outcome {
    return doc === null || doc === undefined ? { count: 0, checksum: "null" } : Outcomes.docs([doc], options);
  }

  /**
   * Fingerprint of the final DB state of collections (read with the driver, sorted by `_id`). Untimed.
   *
   * @param db - The database.
   * @param collections - The collections to fingerprint.
   * @param options - Volatile, omitted and selected fields.
   * @returns The fingerprint.
   */
  static async stateOf(db: Db, collections: readonly string[], options: StateOptions = {}): Promise<string> {
    const parts: string[] = [];
    for (const name of collections) {
      const docs = await db
        .collection(name)
        .find(
          options.filter ?? {},
          options.fields === undefined ? {} : { projection: Object.fromEntries(options.fields.map((f) => [f, 1])) },
        )
        .sort({ _id: 1 })
        .toArray();
      const rows = docs.map((doc) => {
        const row: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(doc)) {
          if (options.omit?.includes(key)) continue;
          row[key] = options.volatile?.includes(key) ? typeTag(value) : value;
        }
        return JSON.stringify(Canonical.of(row));
      });
      if (options.omit?.includes("_id")) rows.sort();
      parts.push(`${name}:${docs.length}:${Bun.hash(rows.join("\n")).toString(16)}`);
    }
    return parts.join("|");
  }

  /**
   * `Outcome` whose `state` is the DB fingerprint and `count` the number of documents in the collections.
   *
   * @param db - The database.
   * @param collections - The collections to fingerprint.
   * @param options - Volatile, omitted and selected fields.
   * @returns The outcome.
   */
  static async state(db: Db, collections: readonly string[], options: StateOptions = {}): Promise<Outcome> {
    let count = 0;
    for (const name of collections) count += await db.collection(name).countDocuments(options.filter ?? {});
    return { count, checksum: "", state: await Outcomes.stateOf(db, collections, options) };
  }

  /**
   * Merges several outcomes (e.g. a result checksum plus the DB state).
   *
   * @param base - The base outcome.
   * @param extra - Fields that replace the base's.
   * @returns The merged outcome.
   */
  static with(base: Outcome, extra: Partial<Outcome>): Outcome {
    return { ...base, ...extra };
  }
}

/** Compares contestants' outcomes; returns human-readable problems (empty = equal work). */
export class OutcomeComparer {
  /**
   * Compares every contestant with the reference (the driver, else the first one).
   *
   * @param outcomes - Outcomes by contestant id.
   * @returns Human-readable problems; empty when all did equal work.
   */
  static compare(outcomes: ReadonlyMap<string, Outcome>): string[] {
    const entries = [...outcomes.entries()];
    const reference = entries.find(([id]) => id === "driver") ?? entries[0];
    if (reference === undefined) return [];
    const [refId, ref] = reference;
    const problems: string[] = [];
    for (const [id, outcome] of entries) {
      if (id === refId) continue;
      if (outcome.count !== ref.count) problems.push(`${id}: count ${outcome.count} ≠ ${refId} ${ref.count}`);
      if (ref.checksum !== "" && outcome.checksum !== "" && outcome.checksum !== ref.checksum) {
        problems.push(`${id}: checksum differs from ${refId}`);
      }
      if (ref.state !== undefined && outcome.state !== undefined && outcome.state !== ref.state) {
        problems.push(`${id}: final DB state differs from ${refId} (${outcome.state} vs ${ref.state})`);
      }
    }
    return problems;
  }
}
