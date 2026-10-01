import { EJSON } from "bson";
import type { Db } from "mongodb";

/**
 * The difference between two snapshots.
 *
 * @example
 * ```ts
 * const diff: DbSnapshotDiff = DbSnapshot.diff(before, after);
 * expect(diff.equal).toBe(true);
 * ```
 */
export interface DbSnapshotDiff {
  /** `"<collection>: <canonical EJSON doc>"` present in `left` but not `right`. */
  readonly onlyInLeft: readonly string[];
  /** Same shape, present in `right` but not `left`. */
  readonly onlyInRight: readonly string[];
  /** `true` when both lists are empty. */
  readonly equal: boolean;
}

/**
 * Canonical, order-independent snapshot of one or more collections.
 * Each document is serialized with canonical EJSON (stable key
 * encoding for every BSON type, including types that plain `JSON.stringify`
 * would mangle: `Decimal128`, `Long`, `Binary`, `Timestamp`, ...), then the
 * documents in every collection are sorted so that snapshot comparisons
 * don't depend on server-side ordering.
 */
export class DbSnapshot {
  /**
   * @param byCollection - Collection name to its sorted canonical documents.
   */
  private constructor(private readonly byCollection: ReadonlyMap<string, readonly string[]>) {}

  /**
   * Reads the collections and serializes their documents.
   *
   * @param db - The database to read.
   * @param collectionNames - Collections to capture; defaults to all of them.
   * @returns The snapshot.
   */
  static async capture(db: Db, collectionNames?: readonly string[]): Promise<DbSnapshot> {
    const names = collectionNames ?? (await DbSnapshot.#listCollectionNames(db));
    const byCollection = new Map<string, readonly string[]>();
    for (const name of names) {
      const docs = await db.collection(name).find({}).toArray();
      const canonical = docs.map((doc) => EJSON.stringify(doc, { relaxed: false })).sort();
      byCollection.set(name, canonical);
    }
    return new DbSnapshot(byCollection);
  }

  /**
   * Sorted names of every collection in a database.
   *
   * @param db - The database.
   * @returns The names.
   */
  static async #listCollectionNames(db: Db): Promise<readonly string[]> {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    return collections.map((collection) => collection.name).sort();
  }

  /**
   * Collection name -> sorted canonical-EJSON documents. Useful for direct assertions.
   *
   * @returns A plain record.
   */
  toRecord(): Readonly<Record<string, readonly string[]>> {
    return Object.fromEntries(this.byCollection);
  }

  /**
   * The captured collection names.
   *
   * @returns Sorted names.
   */
  collectionNames(): readonly string[] {
    return [...this.byCollection.keys()].sort();
  }

  /**
   * The canonical documents of one collection.
   *
   * @param collectionName - The collection.
   * @returns Sorted documents, or an empty list for an unknown collection.
   */
  documentsOf(collectionName: string): readonly string[] {
    return this.byCollection.get(collectionName) ?? [];
  }

  /**
   * Compares two snapshots.
   *
   * @param left - The first snapshot.
   * @param right - The second snapshot.
   * @returns Documents present on only one side.
   */
  static diff(left: DbSnapshot, right: DbSnapshot): DbSnapshotDiff {
    const collectionNames = new Set([...left.byCollection.keys(), ...right.byCollection.keys()]);
    const onlyInLeft: string[] = [];
    const onlyInRight: string[] = [];

    for (const name of collectionNames) {
      const leftDocs = left.documentsOf(name);
      const rightDocs = right.documentsOf(name);
      const rightSet = new Set(rightDocs);
      const leftSet = new Set(leftDocs);

      for (const doc of leftDocs) {
        if (!rightSet.has(doc)) {
          onlyInLeft.push(`${name}: ${doc}`);
        }
      }
      for (const doc of rightDocs) {
        if (!leftSet.has(doc)) {
          onlyInRight.push(`${name}: ${doc}`);
        }
      }
    }

    return { onlyInLeft, onlyInRight, equal: onlyInLeft.length === 0 && onlyInRight.length === 0 };
  }
}
