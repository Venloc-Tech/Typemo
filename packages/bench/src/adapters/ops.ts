import type { Collection, Document } from "mongodb";
import type mongoose from "mongoose";
import type { ShapeDef } from "../data/shapes/shape-def.ts";
import type { ContestantId } from "../harness/types.ts";
import type { BenchContext, MongooseHandle } from "./bench-context.ts";
import { Loose, type LooseQuery, type LooseTypemoModel } from "./loose.ts";

/**
 * A read described once and executed by every contestant.
 *
 * @example
 * ```ts
 * const spec: ReadSpec = { filter: { active: true }, sort: { age: 1 }, limit: 10 };
 * ```
 */
export interface ReadSpec {
  /** The query filter. */
  readonly filter?: Document;
  /** The projection. */
  readonly projection?: Document;
  /** The sort document. */
  readonly sort?: Document;
  /** Documents to skip. */
  readonly skip?: number;
  /** The maximum number of documents. */
  readonly limit?: number;
}

/**
 * Tells whether a value is an object with `$`-operator keys.
 *
 * @param value - Any value.
 * @returns `true` for a plain object that has a key starting with `$`.
 */
const hasDollarKeys = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value as object).some((k) => k.startsWith("$"));

/**
 * Mongoose-safe runs with `sanitizeFilter: true`: operator objects are neutralised unless wrapped in
 * `mongoose.trusted()` — which is exactly what a Mongoose user in that mode must write. Also fresh objects:
 * `sanitizeFilter` mutates the filter it gets.
 */
export class MongooseTrust {
  /**
   * The filter as a Mongoose user in the handle's mode must write it.
   *
   * @param handle - The Mongoose contestant.
   * @param filter - The filter with plain operators.
   * @returns The filter itself, or a copy with operator objects wrapped as trusted in safe mode.
   */
  static filter(handle: MongooseHandle, filter: Document): Document {
    if (!handle.safe) return filter;
    const out: Document = {};
    for (const [key, value] of Object.entries(filter)) {
      if (key === "$and" || key === "$or" || key === "$nor") {
        out[key] = (value as Document[]).map((sub) => MongooseTrust.filter(handle, sub));
      } else if (hasDollarKeys(value)) {
        out[key] = handle.instance.trusted({ ...(value as Document) });
      } else out[key] = value;
    }
    return out;
  }
}

/**
 * One uniform API over the five contestants for GENERIC scenarios (same operation, many shapes). Each method is
 * a thin switch: the timed work is the contestant's own call. `typemo-lean` differs from `typemo` only on reads
 * (`.lean()`); writes of `typemo-lean` are the same calls as `typemo`.
 */
export class ContestantOps {
  /** The driver collection, for the driver contestant. */
  readonly #driver: Collection<Document> | undefined;
  /** The Mongoose model, for the Mongoose contestants. */
  readonly #mongoose: mongoose.Model<Record<string, unknown>> | undefined;
  /** The Mongoose handle, for the Mongoose contestants. */
  readonly #mongooseHandle: MongooseHandle | undefined;
  /** The loosely typed Typemo model, for the Typemo contestants. */
  readonly #typemo: LooseTypemoModel | undefined;
  /** `true` when reads return plain objects. */
  readonly #lean: boolean;

  /**
   * @param contestant - Who runs.
   * @param ctx - The connections.
   * @param def - The shape the operations work on.
   */
  constructor(
    readonly contestant: ContestantId,
    readonly ctx: BenchContext,
    readonly def: ShapeDef<object>,
  ) {
    switch (contestant) {
      case "driver":
        this.#driver = def.driver(ctx.driver);
        break;
      case "mongoose":
      case "mongoose-safe": {
        const handle = contestant === "mongoose" ? ctx.mongoose : ctx.mongooseSafe;
        this.#mongooseHandle = handle;
        this.#mongoose = def.mongoose(handle);
        break;
      }
      case "typemo":
      case "typemo-lean":
        this.#typemo = Loose.typemo(def.typemo(contestant === "typemo" ? ctx.typemo : ctx.typemoLean));
        break;
    }
    this.#lean = contestant === "typemo-lean";
  }

  /**
   * The operations of a contestant on a shape.
   *
   * @param ctx - The connections.
   * @param contestant - Who runs.
   * @param def - The shape the operations work on.
   * @returns The operations.
   */
  static of<E extends object>(ctx: BenchContext, contestant: ContestantId, def: ShapeDef<E>): ContestantOps {
    return new ContestantOps(contestant, ctx, def as unknown as ShapeDef<object>);
  }

  /**
   * The driver collection.
   *
   * @throws Error - When the contestant is not the driver.
   */
  get driver(): Collection<Document> {
    if (this.#driver === undefined) throw new Error(`${this.contestant} is not the driver`);
    return this.#driver;
  }

  /**
   * The Mongoose model.
   *
   * @throws Error - When the contestant is not Mongoose.
   */
  get mongoose(): mongoose.Model<Record<string, unknown>> {
    if (this.#mongoose === undefined) throw new Error(`${this.contestant} is not Mongoose`);
    return this.#mongoose;
  }

  /**
   * The Mongoose handle.
   *
   * @throws Error - When the contestant is not Mongoose.
   */
  get mongooseHandle(): MongooseHandle {
    if (this.#mongooseHandle === undefined) throw new Error(`${this.contestant} is not Mongoose`);
    return this.#mongooseHandle;
  }

  /**
   * The loosely typed Typemo model.
   *
   * @throws Error - When the contestant is not Typemo.
   */
  get typemo(): LooseTypemoModel {
    if (this.#typemo === undefined) throw new Error(`${this.contestant} is not Typemo`);
    return this.#typemo;
  }

  /** Which library the contestant belongs to. */
  get kind(): "driver" | "mongoose" | "typemo" {
    return this.#driver !== undefined ? "driver" : this.#mongoose !== undefined ? "mongoose" : "typemo";
  }

  /**
   * Filter as the contestant must write it (Mongoose-safe: trusted operators).
   *
   * @param filter - The filter with plain operators.
   * @returns The filter in the contestant's form.
   */
  filter(filter: Document): Document {
    return this.#mongooseHandle === undefined ? filter : MongooseTrust.filter(this.#mongooseHandle, filter);
  }

  /**
   * Applies a read spec to a Typemo query.
   *
   * @param query - The query.
   * @param spec - The projection, sort, skip and limit.
   * @returns The query, lean for `typemo-lean`.
   */
  #typemoRead(query: LooseQuery, spec: ReadSpec): LooseQuery {
    let q = query;
    if (spec.projection !== undefined) q = q.select(spec.projection);
    if (spec.sort !== undefined) q = q.sort(spec.sort);
    if (spec.skip !== undefined) q = q.skip(spec.skip);
    if (spec.limit !== undefined) q = q.limit(spec.limit);
    return this.#lean ? q.lean() : q;
  }

  /**
   * Finds documents.
   *
   * @param spec - The read description.
   * @returns The documents in the contestant's own form.
   */
  async find(spec: ReadSpec = {}): Promise<unknown[]> {
    const filter = spec.filter ?? {};
    switch (this.kind) {
      case "driver":
        return this.driver
          .find(filter, {
            ...(spec.projection !== undefined ? { projection: spec.projection } : {}),
            ...(spec.sort !== undefined ? { sort: spec.sort } : {}),
            ...(spec.skip !== undefined ? { skip: spec.skip } : {}),
            ...(spec.limit !== undefined ? { limit: spec.limit } : {}),
          })
          .toArray();
      case "mongoose": {
        let q = this.mongoose.find(this.filter(filter));
        if (spec.projection !== undefined) q = q.select(spec.projection);
        if (spec.sort !== undefined) q = q.sort(spec.sort as Record<string, 1 | -1>);
        if (spec.skip !== undefined) q = q.skip(spec.skip);
        if (spec.limit !== undefined) q = q.limit(spec.limit);
        return q.exec() as Promise<unknown[]>;
      }
      case "typemo":
        return Loose.list(await this.#typemoRead(this.typemo.find(filter), spec));
    }
  }

  /**
   * Finds one document.
   *
   * @param filter - The query filter.
   * @param projection - The projection.
   * @returns The document, or `null`.
   */
  async findOne(filter: Document, projection?: Document): Promise<unknown> {
    switch (this.kind) {
      case "driver":
        return this.driver.findOne(filter, projection !== undefined ? { projection } : {});
      case "mongoose": {
        const q = this.mongoose.findOne(this.filter(filter));
        return (projection !== undefined ? q.select(projection) : q).exec();
      }
      case "typemo":
        return this.#typemoRead(this.typemo.findOne(filter), projection !== undefined ? { projection } : {});
    }
  }

  /**
   * Counts matching documents.
   *
   * @param filter - The query filter.
   * @returns The count.
   */
  async count(filter: Document): Promise<number> {
    switch (this.kind) {
      case "driver":
        return this.driver.countDocuments(filter);
      case "mongoose":
        return this.mongoose.countDocuments(this.filter(filter)).exec();
      case "typemo":
        return this.typemo.countDocuments(filter);
    }
  }

  /**
   * Distinct values of a path.
   *
   * @param path - The dotted path.
   * @param filter - The query filter.
   * @returns The distinct values.
   */
  async distinct(path: string, filter: Document = {}): Promise<unknown[]> {
    switch (this.kind) {
      case "driver":
        return this.driver.distinct(path, filter);
      case "mongoose":
        return this.mongoose.distinct(path, this.filter(filter)).exec() as Promise<unknown[]>;
      case "typemo":
        return Loose.list(await this.typemo.distinct(path, filter));
    }
  }

  /**
   * `{ _id } | null` for every contestant.
   *
   * @param filter - The query filter.
   * @returns The id document, or `null`.
   */
  async exists(filter: Document): Promise<unknown> {
    switch (this.kind) {
      case "driver":
        return this.driver.findOne(filter, { projection: { _id: 1 } });
      case "mongoose":
        return this.mongoose.exists(this.filter(filter)).exec();
      case "typemo":
        return this.typemo.exists(filter);
    }
  }

  /**
   * Inserts several documents.
   *
   * @param docs - The documents.
   * @param ordered - Stop at the first error.
   * @returns The number of inserted documents.
   */
  async insertMany(docs: readonly Document[], ordered = true): Promise<number> {
    switch (this.kind) {
      case "driver":
        /* The driver mutates its argument (adds `_id`): give it copies like the ODMs effectively do. */
        return (
          await this.driver.insertMany(
            docs.map((d) => ({ ...d })),
            { ordered },
          )
        ).insertedCount;
      case "mongoose":
        return (await this.mongoose.insertMany(docs, { ordered })).length;
      case "typemo":
        return (await this.typemo.insertMany(docs, { ordered })).length;
    }
  }

  /**
   * Document-path create: Mongoose `Model.create`, Typemo `create` (hooks, validation, save path).
   *
   * @param doc - The values.
   * @returns The created document, or the driver's insert result.
   */
  async create(doc: Document): Promise<unknown> {
    switch (this.kind) {
      case "driver":
        return this.driver.insertOne({ ...doc });
      case "mongoose":
        return this.mongoose.create(doc);
      case "typemo":
        return this.typemo.create(doc);
    }
  }

  /**
   * Updates one document.
   *
   * @param filter - The query filter.
   * @param update - The update.
   * @param options - Update options.
   * @returns Matched plus upserted documents.
   */
  async updateOne(filter: Document, update: Document, options: Document = {}): Promise<number> {
    switch (this.kind) {
      case "driver":
        return ContestantOps.touched(await this.driver.updateOne(filter, update, options));
      case "mongoose":
        return ContestantOps.touched(await this.mongoose.updateOne(this.filter(filter), update, options).exec());
      case "typemo":
        return ContestantOps.touched(await this.typemo.updateOne(filter, update, options));
    }
  }

  /**
   * Updates every matching document.
   *
   * @param filter - The query filter.
   * @param update - The update.
   * @param options - Update options.
   * @returns Matched plus upserted documents.
   */
  async updateMany(filter: Document, update: Document, options: Document = {}): Promise<number> {
    switch (this.kind) {
      case "driver":
        return ContestantOps.touched(await this.driver.updateMany(filter, update, options));
      case "mongoose":
        return ContestantOps.touched(await this.mongoose.updateMany(this.filter(filter), update, options).exec());
      case "typemo":
        return ContestantOps.touched(await this.typemo.updateMany(filter, update, options));
    }
  }

  /**
   * Replaces one document.
   *
   * @param filter - The query filter.
   * @param replacement - The new document.
   * @returns Matched plus upserted documents.
   */
  async replaceOne(filter: Document, replacement: Document): Promise<number> {
    switch (this.kind) {
      case "driver":
        return ContestantOps.touched(await this.driver.replaceOne(filter, replacement));
      case "mongoose":
        return ContestantOps.touched(await this.mongoose.replaceOne(this.filter(filter), replacement).exec());
      case "typemo":
        return ContestantOps.touched(await this.typemo.replaceOne(filter, replacement));
    }
  }

  /**
   * Returns the document AFTER the update for every contestant (Mongoose/driver default to before).
   *
   * @param filter - The query filter.
   * @param update - The update.
   * @param options - Extra options.
   * @returns The updated document, in the contestant's own form.
   */
  async findOneAndUpdate(filter: Document, update: Document, options: Document = {}): Promise<unknown> {
    switch (this.kind) {
      case "driver":
        return this.driver.findOneAndUpdate(filter, update, { returnDocument: "after", ...options });
      case "mongoose":
        return this.mongoose
          .findOneAndUpdate(this.filter(filter), update, { returnDocument: "after", ...options })
          .exec();
      case "typemo": {
        const q = this.typemo.findOneAndUpdate(filter, update, { returnDocument: "after", ...options });
        return this.#lean ? q.lean() : q;
      }
    }
  }

  /**
   * Deletes one document.
   *
   * @param filter - The query filter.
   * @returns The number of deleted documents.
   */
  async deleteOne(filter: Document): Promise<number> {
    switch (this.kind) {
      case "driver":
        return (await this.driver.deleteOne(filter)).deletedCount;
      case "mongoose":
        return (await this.mongoose.deleteOne(this.filter(filter)).exec()).deletedCount;
      case "typemo":
        return ContestantOps.deleted(await this.typemo.deleteOne(filter));
    }
  }

  /**
   * Deletes every matching document.
   *
   * @param filter - The query filter.
   * @returns The number of deleted documents.
   */
  async deleteMany(filter: Document): Promise<number> {
    switch (this.kind) {
      case "driver":
        return (await this.driver.deleteMany(filter)).deletedCount;
      case "mongoose":
        return (await this.mongoose.deleteMany(this.filter(filter)).exec()).deletedCount;
      case "typemo":
        return ContestantOps.deleted(await this.typemo.deleteMany(filter));
    }
  }

  /**
   * `matchedCount + upsertedCount` of an update result of any contestant.
   *
   * @param result - An update result.
   * @returns The number of touched documents.
   */
  static touched(result: unknown): number {
    const r = result as { readonly matchedCount?: number; readonly upsertedCount?: number };
    return (r.matchedCount ?? 0) + (r.upsertedCount ?? 0);
  }

  /**
   * `deletedCount` of a delete result of any contestant.
   *
   * @param result - A delete result.
   * @returns The number of deleted documents.
   */
  static deleted(result: unknown): number {
    return (result as { readonly deletedCount?: number }).deletedCount ?? 0;
  }
}
