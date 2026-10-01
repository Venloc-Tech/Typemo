import { BSON, type Db, type Document, type ObjectId } from "mongodb";
import type { BenchContext } from "../adapters/bench-context.ts";
import { CONTESTANTS, type ContestantId, type SizeName } from "../harness/types.ts";
import { Checksum } from "../harness/verify.ts";
import type { ShapeDef } from "./shapes/shape-def.ts";

/** The collection that records which dataset is seeded. */
const MARKERS = "bench_markers";
/** Most documents inserted per batch. */
const BATCH = 1_000;

/**
 * Seeds identical datasets into every contestant's database (untimed). Idempotent: a marker document
 * `{ _id: <collection>, shape, count, version }` says what is already there, so read scenarios share one seed.
 * Write scenarios call `reset`/`seed` themselves.
 */
export class Datasets {
  /** Bump to re-seed every dataset. */
  static readonly VERSION = 1;

  /**
   * @param ctx - The contestants' connections.
   */
  constructor(readonly ctx: BenchContext) {}

  /**
   * The databases of some contestants.
   *
   * @param contestants - Whose databases; all five by default.
   * @returns The databases.
   */
  #dbs(contestants: readonly ContestantId[] = CONTESTANTS): Db[] {
    return contestants.map((c) => this.ctx.dbOf(c));
  }

  /**
   * Ensures `def.countFor(size)` documents (stored form) plus the shape's indexes in all five databases.
   *
   * @param def - The shape.
   * @param size - The dataset size.
   * @param count - The document count; defaults to the shape's count for the size.
   * @returns The document count.
   */
  async ensure<E extends object>(def: ShapeDef<E>, size: SizeName, count = def.countFor(size)): Promise<number> {
    const stale: Db[] = [];
    for (const db of this.#dbs()) if (!(await Datasets.#fresh(db, def, count))) stale.push(db);
    if (stale.length === 0) return count;
    await Promise.all(
      stale.map(async (db) => {
        await db
          .collection(def.collection)
          .drop()
          .catch(() => false);
        await Datasets.createIndexes(db, def);
      }),
    );
    await Datasets.insertStoredInto(stale, def, 0, count);
    await Promise.all(
      stale.map((db) =>
        db
          .collection(MARKERS)
          .replaceOne(
            { _id: def.collection as unknown as ObjectId },
            { shape: def.name, count, version: Datasets.VERSION, sig: Datasets.signature(def), at: new Date() },
            { upsert: true },
          ),
      ),
    );
    return count;
  }

  /**
   * Tells whether the seeded dataset in a database is current.
   *
   * @param db - The database.
   * @param def - The shape.
   * @param count - The expected document count.
   * @returns `true` when the marker and the document count match.
   */
  static async #fresh<E extends object>(db: Db, def: ShapeDef<E>, count: number): Promise<boolean> {
    const marker = await db.collection(MARKERS).findOne({ _id: def.collection as unknown as ObjectId });
    if (
      marker === null ||
      marker.count !== count ||
      marker.version !== Datasets.VERSION ||
      marker.shape !== def.name ||
      marker.sig !== Datasets.signature(def)
    ) {
      return false;
    }
    return (await db.collection(def.collection).estimatedDocumentCount()) === count;
  }

  /**
   * Changes when the generator or the model defaults change (stale seeds are re-seeded).
   *
   * @param def - The shape.
   * @returns A checksum of the first two stored documents.
   */
  static signature<E extends object>(def: ShapeDef<E>): string {
    return Checksum.of([def.stored(0), def.stored(1)]);
  }

  /**
   * Empties a collection in the given contestants' databases and recreates the indexes (untimed).
   *
   * @param def - The shape.
   * @param contestants - Whose databases; all five by default.
   */
  async reset<E extends object>(def: ShapeDef<E>, contestants: readonly ContestantId[] = CONTESTANTS): Promise<void> {
    await Promise.all(
      this.#dbs(contestants).map(async (db) => {
        await db
          .collection(def.collection)
          .drop()
          .catch(() => false);
        await db.collection(MARKERS).deleteOne({ _id: def.collection as unknown as ObjectId });
        await Datasets.createIndexes(db, def);
      }),
    );
  }

  /**
   * Resets and inserts `count` stored documents for the given contestants (write scenarios).
   *
   * @param def - The shape.
   * @param count - How many documents.
   * @param contestants - Whose databases; all five by default.
   */
  async seed<E extends object>(
    def: ShapeDef<E>,
    count: number,
    contestants: readonly ContestantId[] = CONTESTANTS,
  ): Promise<void> {
    await this.reset(def, contestants);
    await Datasets.insertStoredInto(this.#dbs(contestants), def, 0, count);
  }

  /**
   * Deterministic ids of the first `count` documents.
   *
   * @param def - The shape.
   * @param count - How many ids.
   * @returns The ids.
   */
  ids<E extends object>(def: ShapeDef<E>, count: number): ObjectId[] {
    const out: ObjectId[] = [];
    for (let i = 0; i < count; i++) out.push(def.id(i));
    return out;
  }

  /**
   * Creates the collection and the shape's indexes.
   *
   * @param db - The database.
   * @param def - The shape.
   */
  static async createIndexes<E extends object>(db: Db, def: ShapeDef<E>): Promise<void> {
    await db.createCollection(def.collection).catch(() => undefined);
    if (def.spec.indexes.length === 0) return;
    await db
      .collection(def.collection)
      .createIndexes(def.spec.indexes.map((index) => ({ key: { ...index.keys }, ...(index.options ?? {}) })));
  }

  /**
   * Generates each batch once and inserts it into every database (generation is the expensive part).
   *
   * @param dbs - The target databases.
   * @param def - The shape.
   * @param from - Index of the first document.
   * @param count - How many documents.
   */
  static async insertStoredInto<E extends object>(
    dbs: readonly Db[],
    def: ShapeDef<E>,
    from: number,
    count: number,
  ): Promise<void> {
    const batch = Math.max(1, Math.min(BATCH, Math.floor(8_000_000 / Datasets.approxSize(def))));
    for (let start = from; start < from + count; start += batch) {
      const docs = def.storedMany(start, Math.min(batch, from + count - start));
      await Promise.all(dbs.map((db) => db.collection<Document>(def.collection).insertMany(docs, { ordered: false })));
    }
  }

  /**
   * Rough BSON size of one document of the shape (batches stay under the 48 MB message limit).
   *
   * @param def - The shape.
   * @returns The size in bytes, at least 64.
   */
  static approxSize<E extends object>(def: ShapeDef<E>): number {
    const cached = Datasets.#sizes.get(def.name);
    if (cached !== undefined) return cached;
    const size = Math.max(64, BSON.calculateObjectSize(def.stored(0)));
    Datasets.#sizes.set(def.name, size);
    return size;
  }

  /** Cached document sizes by shape name. */
  static readonly #sizes = new Map<string, number>();
}
