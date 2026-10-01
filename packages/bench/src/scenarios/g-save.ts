import type { AnyBulkWriteOperation, Document, ObjectId } from "mongodb";
import type mongoose from "mongoose";
import { Loose, type LooseDoc } from "../adapters/loose.ts";
import type { ContestantOps } from "../adapters/ops.ts";
import { LARGE, MEDIUM, type ShapeDef, VERSIONED } from "../data/shapes/index.ts";
import { OpScenario, WRITERS } from "../harness/op-scenario.ts";
import type { Scenario, ScenarioEnv } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { Outcomes } from "../harness/verify.ts";

/* Group G: the document save path — change and save, no-op save, optimistic concurrency and bulkSave. */

/** Profiles that run the heavier scenarios. */
const STANDARD: readonly ProfileName[] = ["standard", "full"];
/** Every profile. */
const EVERY: readonly ProfileName[] = ["quick", "standard", "full"];
/**
 * Deterministic spread of iteration → document index.
 *
 * @param i - The iteration.
 * @param n - The number of documents.
 * @returns An index in `[0, n)`.
 */
const spread = (i: number, n: number): number => (i * 7919 + 13) % n;

/**
 * A hydrated Mongoose document with indexable fields.
 *
 * @example
 * ```ts
 * const doc = loaded as MongooseDoc;
 * doc.set("rating", 3);
 * ```
 */
type MongooseDoc = mongoose.Document & Record<string, unknown>;

/**
 * The document save path: the document is loaded in the untimed `before`, the timed part is "change + save".
 * The raw driver does what the ODM would send: one `updateOne` with the changed paths (its user computes them by
 * hand). Verification reads the saved fields back and compares them across contestants.
 */
abstract class SaveScenario extends OpScenario<object> {
  readonly group = "G" as const;
  override readonly scope = "write" as const;
  override readonly contestants: readonly ContestantId[] = WRITERS;
  /** Fields compared after the save. */
  abstract readonly fields: readonly string[];
  /** The document each contestant loaded in `before`. */
  readonly #loaded = new Map<ContestantId, unknown>();

  /**
   * The index of the document an iteration saves.
   *
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The document index.
   */
  target(i: number, env: ScenarioEnv): number {
    return spread(i, Math.min(this.countOf(env), 1_000));
  }

  /**
   * Untimed: bring the target document into a known state (the previous sample changed it).
   *
   * @param i - The iteration.
   * @returns The `$set` that restores the document.
   */
  abstract reset(i: number): Document;

  /**
   * Restores the document and loads it the way the contestant would (untimed).
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   */
  override async before(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<void> {
    const _id = this.def.id(this.target(i, env));
    await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .updateOne({ _id }, { $set: this.reset(i) });
    switch (ops.kind) {
      case "driver":
        this.#loaded.set(ops.contestant, _id);
        break;
      case "mongoose":
        this.#loaded.set(ops.contestant, await ops.mongoose.findById(_id).orFail().exec());
        break;
      case "typemo":
        this.#loaded.set(ops.contestant, await ops.typemo.findById(_id));
        break;
    }
  }

  /**
   * What `before` loaded for a contestant.
   *
   * @param ops - The contestant's operations.
   * @returns The id for the driver, otherwise the document.
   */
  loaded(ops: ContestantOps): unknown {
    return this.#loaded.get(ops.contestant);
  }

  /**
   * The loaded Mongoose document.
   *
   * @param ops - The contestant's operations.
   * @returns The document.
   */
  mongooseDoc(ops: ContestantOps): MongooseDoc {
    return this.loaded(ops) as MongooseDoc;
  }

  /**
   * The loaded Typemo document.
   *
   * @param ops - The contestant's operations.
   * @returns The document.
   */
  typemoDoc(ops: ContestantOps): LooseDoc {
    return Loose.doc(this.loaded(ops));
  }

  /**
   * Reads the saved fields back.
   *
   * @param _r - Unused.
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The outcome over the compared fields.
   */
  override async outcome(_r: unknown, ops: ContestantOps, i: number, env: ScenarioEnv): Promise<Outcome> {
    const doc = await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .findOne(
        { _id: this.def.id(this.target(i, env)) },
        { projection: Object.fromEntries(this.fields.map((f) => [f, 1])) },
      );
    return Outcomes.doc(doc);
  }
}

/** Changes two scalars and saves. */
class SaveScalar extends SaveScenario {
  readonly id = "G.save.scalar";
  readonly title = "изменить 2 скаляра и save (medium)";
  readonly profiles = EVERY;
  override readonly sizes: readonly SizeName[] = ["S"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  readonly fields = ["rating", "notes"];
  /**
   * The base state.
   *
   * @returns The `$set` that restores the document.
   */
  reset(): Document {
    return { rating: 1, notes: "base" };
  }
  /**
   * Changes the two scalars and saves.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which determines the values.
   * @returns The save result.
   */
  async op(ops: ContestantOps, i: number): Promise<unknown> {
    const rating = (i % 5) + 1;
    const notes = `saved ${i}`;
    switch (ops.kind) {
      case "driver":
        return ops.driver.updateOne({ _id: this.loaded(ops) as ObjectId }, { $set: { rating, notes } });
      case "mongoose": {
        const doc = this.mongooseDoc(ops);
        doc.set({ rating, notes });
        return doc.save();
      }
      case "typemo": {
        const doc = this.typemoDoc(ops);
        doc.rating = rating;
        doc.notes = notes;
        return doc.$save();
      }
    }
  }
}

/** Pushes to an array of the document and saves. */
class SavePush extends SaveScenario {
  readonly id = "G.save.push";
  readonly title = "push в массив документа и save (medium.tags)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  readonly fields = ["tags"];
  /**
   * The base state.
   *
   * @returns The `$set` that restores the document.
   */
  reset(): Document {
    return { tags: ["alpha", "bravo"] };
  }
  /**
   * Pushes a tag and saves.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which determines the tag.
   * @returns The save result.
   */
  async op(ops: ContestantOps, i: number): Promise<unknown> {
    const tag = `t${i % 9}`;
    switch (ops.kind) {
      case "driver":
        return ops.driver.updateOne({ _id: this.loaded(ops) as ObjectId }, { $push: { tags: tag } } as Document);
      case "mongoose": {
        const doc = this.mongooseDoc(ops);
        (doc.tags as string[]).push(tag);
        return doc.save();
      }
      case "typemo": {
        const doc = this.typemoDoc(ops);
        (doc.tags as string[]).push(tag);
        return doc.$save();
      }
    }
  }
}

/** Changes fields of subdocuments of a large document and saves. */
class SaveSubdoc extends SaveScenario {
  readonly id = "G.save.subdoc";
  readonly title = "изменить поле поддокумента в большом документе и save (large.items[7].qty)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S"];
  readonly def = LARGE as unknown as ShapeDef<object>;
  readonly fields = ["items"];
  /**
   * The index of the document an iteration saves; any document of the collection.
   *
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The document index.
   */
  override target(i: number, env: ScenarioEnv): number {
    return spread(i, this.countOf(env));
  }
  /**
   * The base state.
   *
   * @returns The `$set` that restores the document.
   */
  reset(): Document {
    return { "items.7.qty": 1, "items.9.price": 10.5 };
  }
  /**
   * Changes two subdocument fields and saves.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which determines the values.
   * @returns The save result.
   */
  async op(ops: ContestantOps, i: number): Promise<unknown> {
    const qty = (i % 50) + 2;
    const price = (i % 90) + 0.75;
    switch (ops.kind) {
      case "driver":
        return ops.driver.updateOne(
          { _id: this.loaded(ops) as ObjectId },
          { $set: { "items.7.qty": qty, "items.9.price": price } },
        );
      case "mongoose": {
        const doc = this.mongooseDoc(ops);
        const items = doc.items as MongooseDoc[];
        items[7]?.set("qty", qty);
        items[9]?.set("price", price);
        return doc.save();
      }
      case "typemo": {
        const doc = this.typemoDoc(ops);
        const items = doc.items as LooseDoc[];
        items[7]?.$set("qty", qty);
        items[9]?.$set("price", price);
        return doc.$save();
      }
    }
  }
}

/** Saves a document that has not changed. */
class SaveNoop extends SaveScenario {
  readonly id = "G.save.noop";
  readonly title = "save без изменений (ничего не должно уйти на сервер)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  readonly fields = ["rating", "notes"];
  /**
   * The base state.
   *
   * @returns The `$set` that restores the document.
   */
  reset(): Document {
    return { rating: 2, notes: "noop" };
  }
  /**
   * Saves the unchanged document.
   *
   * @param ops - The contestant's operations.
   * @returns The save result; the driver does nothing.
   */
  async op(ops: ContestantOps): Promise<unknown> {
    switch (ops.kind) {
      case "driver":
        return null;
      case "mongoose":
        return this.mongooseDoc(ops).save();
      case "typemo":
        return this.typemoDoc(ops).$save();
    }
  }
}

/** Saves a document with optimistic concurrency. */
class SaveVersioned extends SaveScenario {
  readonly id = "G.save.optimistic";
  readonly title = "save с optimistic concurrency (__v в фильтре и $inc)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S"];
  readonly def = VERSIONED as unknown as ShapeDef<object>;
  readonly fields = ["score", "__v"];
  /**
   * The base state.
   *
   * @returns The `$set` that restores the document.
   */
  reset(): Document {
    return { score: 1.5, __v: 0 };
  }
  /**
   * Changes the score and saves, checking the version.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which determines the score.
   * @returns The save result.
   * @throws Error - When the raw driver's versioned update matches nothing.
   */
  async op(ops: ContestantOps, i: number): Promise<unknown> {
    const score = (i % 100) + 0.5;
    switch (ops.kind) {
      case "driver": {
        const r = await ops.driver.updateOne(
          { _id: this.loaded(ops) as ObjectId, __v: 0 },
          { $set: { score }, $inc: { __v: 1 } },
        );
        if (r.matchedCount !== 1) throw new Error("version conflict");
        return r;
      }
      case "mongoose": {
        const doc = this.mongooseDoc(ops);
        doc.set("score", score);
        return doc.save();
      }
      case "typemo": {
        const doc = this.typemoDoc(ops);
        doc.score = score;
        return doc.$save();
      }
    }
  }
}

/** Load 100 documents (untimed), change each, save them all in one call. */
class BulkSave extends OpScenario<object> {
  readonly id = "G.bulkSave";
  readonly group = "G" as const;
  readonly title = "bulkSave 100 изменённых документов (medium)";
  readonly profiles = STANDARD;
  override readonly scope = "write" as const;
  override readonly contestants: readonly ContestantId[] = WRITERS;
  override readonly sizes: readonly SizeName[] = ["S"];
  override readonly iterations = { maxSamples: 60 };
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /** The documents each contestant loaded in `before`. */
  readonly #loaded = new Map<ContestantId, unknown[]>();
  /**
   * Documents per operation.
   *
   * @returns `100`.
   */
  override unitsPerOp(): number {
    return 100;
  }
  /**
   * The ids of the documents that are saved.
   *
   * @returns One hundred ids.
   */
  ids(): ObjectId[] {
    return Array.from({ length: 100 }, (_, k) => this.def.id(k));
  }
  /**
   * Restores and loads the documents (untimed).
   *
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   */
  override async before(ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<void> {
    await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .updateMany({ _id: { $in: this.ids() } }, { $set: { rating: 1 } });
    const filter = { _id: { $in: this.ids() } };
    switch (ops.kind) {
      case "driver":
        this.#loaded.set(ops.contestant, this.ids());
        break;
      case "mongoose":
        this.#loaded.set(ops.contestant, await ops.mongoose.find(ops.filter(filter)).sort({ _id: 1 }).exec());
        break;
      case "typemo":
        this.#loaded.set(ops.contestant, Loose.list(await ops.typemo.find(filter).sort({ _id: 1 })));
        break;
    }
  }
  /**
   * Changes every loaded document and saves them in one call.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which determines the rating.
   * @returns The bulk result.
   */
  async op(ops: ContestantOps, i: number): Promise<unknown> {
    const loaded = this.#loaded.get(ops.contestant) ?? [];
    const rating = (i % 4) + 2;
    switch (ops.kind) {
      case "driver":
        return ops.driver.bulkWrite(
          (loaded as ObjectId[]).map((_id) => ({
            updateOne: { filter: { _id }, update: { $set: { rating } } },
          })) as AnyBulkWriteOperation<Document>[],
        );
      case "mongoose": {
        const docs = loaded as MongooseDoc[];
        for (const doc of docs) doc.set("rating", rating);
        return ops.mongoose.bulkSave(docs as unknown as Parameters<typeof ops.mongoose.bulkSave>[0]);
      }
      case "typemo": {
        const docs = Loose.docs(loaded);
        for (const doc of docs) doc.rating = rating;
        return ops.typemo.bulkSave(docs);
      }
    }
  }
  /**
   * Reads the saved ratings back.
   *
   * @param _r - Unused.
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   * @returns The outcome over the saved documents.
   */
  override async outcome(_r: unknown, ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<Outcome> {
    const docs = await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .find({ _id: { $in: this.ids() } }, { projection: { rating: 1 } })
      .sort({ _id: 1 })
      .toArray();
    return Outcomes.docs(docs);
  }
}

/** The scenarios of group G. */
export const SCENARIOS: readonly Scenario[] = [
  new SaveScalar(),
  new SavePush(),
  new SaveSubdoc(),
  new SaveNoop(),
  new SaveVersioned(),
  new BulkSave(),
];
