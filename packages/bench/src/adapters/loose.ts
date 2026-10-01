import type { Model } from "@venloc/typemo";
import type { Document } from "mongodb";

/*
 * Structural, untyped views of a Typemo model for GENERIC scenarios (one code path for many shapes, filters built
 * from data). The runtime is exactly the same objects — only the compile-time types are loosened, because
 * Typemo's typed API checks literal filter keys that a data-driven benchmark cannot spell out. Scenarios
 * that show typed usage call the real `Model<T>` directly.
 */

/**
 * An untyped cursor.
 *
 * @example
 * ```ts
 * const rows: unknown[] = await cursor.toArray();
 * ```
 */
export interface LooseCursor extends AsyncIterable<unknown> {
  /**
   * The next document.
   *
   * @returns The document, or `null` at the end.
   */
  next(): Promise<unknown>;
  /**
   * Closes the cursor.
   *
   * @returns Resolves when closed.
   */
  close(): Promise<void>;
  /**
   * Reads every remaining document.
   *
   * @returns The documents.
   */
  toArray(): Promise<unknown[]>;
  /**
   * Calls a function for each document.
   *
   * @param fn - Called per document.
   * @param options - Concurrency and error handling.
   * @returns Resolves when every document was handled.
   */
  eachAsync(
    fn: (doc: unknown) => unknown,
    options?: { readonly parallel?: number; readonly batchSize?: number; readonly continueOnError?: boolean },
  ): Promise<void>;
}

/**
 * An untyped query builder.
 *
 * @example
 * ```ts
 * const docs = await model.find({}).sort({ n: 1 }).limit(10).lean();
 * ```
 */
export interface LooseQuery extends PromiseLike<unknown> {
  /**
   * Restricts the returned fields.
   *
   * @param projection - The projection.
   * @returns The same query.
   */
  select(projection: Document): LooseQuery;
  /**
   * Sorts the result.
   *
   * @param sort - The sort document.
   * @returns The same query.
   */
  sort(sort: Document): LooseQuery;
  /**
   * Skips documents.
   *
   * @param n - How many.
   * @returns The same query.
   */
  skip(n: number): LooseQuery;
  /**
   * Limits the result size.
   *
   * @param n - The maximum.
   * @returns The same query.
   */
  limit(n: number): LooseQuery;
  /**
   * Returns plain objects instead of hydrated documents.
   *
   * @returns The same query.
   */
  lean(): LooseQuery;
  /**
   * Sets the cursor batch size.
   *
   * @param n - Documents per batch.
   * @returns The same query.
   */
  batchSize(n: number): LooseQuery;
  /**
   * Opens a cursor instead of loading everything.
   *
   * @returns The cursor.
   */
  cursor(): LooseCursor;
  /**
   * Runs the query.
   *
   * @returns The result.
   */
  exec(): Promise<unknown>;
}

/**
 * An untyped write operation; awaiting it runs it.
 *
 * @example
 * ```ts
 * const result: unknown = await model.updateOne({ _id: id }, { $set: { n: 1 } });
 * ```
 */
export type LooseWrite = PromiseLike<unknown>;

/**
 * An untyped hydrated document.
 *
 * @example
 * ```ts
 * const doc: LooseDoc = Loose.doc(await model.findOne({}));
 * doc.$set("name", "x");
 * ```
 */
export interface LooseDoc {
  /**
   * Saves the document.
   *
   * @param options - Save options.
   * @returns The save result.
   */
  $save(options?: Document): Promise<unknown>;
  /**
   * The plain object form.
   *
   * @param options - Conversion options.
   * @returns The object.
   */
  $toObject(options?: Document): unknown;
  /**
   * The JSON form.
   *
   * @param options - Conversion options.
   * @returns The JSON-compatible value.
   */
  $toJSON(options?: Document): unknown;
  /**
   * Sets a path.
   *
   * @param path - The dotted path.
   * @param value - The new value.
   */
  $set(path: string, value: unknown): void;
  /**
   * Reads a path.
   *
   * @param path - The dotted path.
   * @returns The value.
   */
  $get(path: string): unknown;
  /**
   * Deletes the document.
   *
   * @param options - Delete options.
   * @returns The delete result.
   */
  $deleteOne(options?: Document): Promise<unknown>;
  /**
   * The pending changes.
   *
   * @returns The changes as an update description.
   */
  $getChanges(): unknown;
  /**
   * Tells whether a path (or anything) is modified.
   *
   * @param path - The dotted path; omitted for the whole document.
   * @returns `true` when modified.
   */
  $isModified(path?: string): boolean;
  /**
   * Marks a path as modified.
   *
   * @param path - The dotted path.
   */
  $markModified(path: string): void;
  /** Field values. */
  [key: string]: unknown;
}

/**
 * An untyped view of a Typemo `Model`.
 *
 * @example
 * ```ts
 * const users: LooseTypemoModel = Loose.typemo(UserModel);
 * const docs = await users.find({ active: true });
 * ```
 */
export interface LooseTypemoModel {
  /**
   * Finds documents.
   *
   * @param filter - The query filter.
   * @returns The query.
   */
  find(filter?: Document): LooseQuery;
  /**
   * Finds one document.
   *
   * @param filter - The query filter.
   * @returns The query.
   */
  findOne(filter?: Document): LooseQuery;
  /**
   * Finds a document by id.
   *
   * @param id - The `_id`.
   * @returns The query.
   */
  findById(id: unknown): LooseQuery;
  /**
   * Counts matching documents.
   *
   * @param filter - The query filter.
   * @returns The count.
   */
  countDocuments(filter?: Document): PromiseLike<number>;
  /**
   * Counts documents from collection metadata.
   *
   * @returns The count.
   */
  estimatedDocumentCount(): PromiseLike<number>;
  /**
   * Distinct values of a path.
   *
   * @param path - The dotted path.
   * @param filter - The query filter.
   * @returns The distinct values.
   */
  distinct(path: string, filter?: Document): PromiseLike<unknown[]>;
  /**
   * Tells whether a document matches.
   *
   * @param filter - The query filter.
   * @returns The result.
   */
  exists(filter: Document): PromiseLike<unknown>;
  /**
   * Builds a new, unsaved document.
   *
   * @param doc - The initial values.
   * @returns The document.
   */
  "new"(doc: Document): LooseDoc;
  /**
   * Creates and saves one document.
   *
   * @param doc - The values.
   * @param options - Save options.
   * @returns The saved document.
   */
  create(doc: Document, options?: Document): Promise<LooseDoc>;
  /**
   * Creates and saves several documents.
   *
   * @param docs - The values.
   * @param options - Save options.
   * @returns The saved documents.
   */
  create(docs: readonly Document[], options?: Document): Promise<LooseDoc[]>;
  /**
   * Inserts one document.
   *
   * @param doc - The values.
   * @param options - Insert options.
   * @returns The inserted document.
   */
  insertOne(doc: Document, options?: Document): Promise<LooseDoc>;
  /**
   * Inserts several documents.
   *
   * @param docs - The values.
   * @param options - Insert options.
   * @returns The inserted documents.
   */
  insertMany(docs: readonly Document[], options?: Document): Promise<LooseDoc[]>;
  /**
   * Runs a bulk write.
   *
   * @param operations - The operations.
   * @param options - Bulk options.
   * @returns The bulk result.
   */
  bulkWrite(operations: readonly Document[], options?: Document): Promise<unknown>;
  /**
   * Saves several documents with one bulk write.
   *
   * @param docs - The documents.
   * @param options - Bulk options.
   * @returns The bulk result.
   */
  bulkSave(docs: readonly LooseDoc[], options?: Document): Promise<unknown>;
  /**
   * Updates one document.
   *
   * @param filter - The query filter.
   * @param update - The update.
   * @param options - Update options.
   * @returns The write.
   */
  updateOne(filter: Document, update: Document, options?: Document): LooseWrite;
  /**
   * Updates every matching document.
   *
   * @param filter - The query filter.
   * @param update - The update.
   * @param options - Update options.
   * @returns The write.
   */
  updateMany(filter: Document, update: Document, options?: Document): LooseWrite;
  /**
   * Replaces one document.
   *
   * @param filter - The query filter.
   * @param replacement - The new document.
   * @param options - Replace options.
   * @returns The write.
   */
  replaceOne(filter: Document, replacement: Document, options?: Document): LooseWrite;
  /**
   * Deletes one document.
   *
   * @param filter - The query filter.
   * @returns The write.
   */
  deleteOne(filter: Document): LooseWrite;
  /**
   * Deletes every matching document.
   *
   * @param filter - The query filter.
   * @returns The write.
   */
  deleteMany(filter: Document): LooseWrite;
  /**
   * Updates one document and returns it.
   *
   * @param filter - The query filter.
   * @param update - The update.
   * @param options - Options such as `returnDocument`.
   * @returns The query.
   */
  findOneAndUpdate(filter: Document, update: Document, options?: Document): LooseQuery;
  /**
   * Replaces one document and returns it.
   *
   * @param filter - The query filter.
   * @param replacement - The new document.
   * @param options - Options such as `returnDocument`.
   * @returns The query.
   */
  findOneAndReplace(filter: Document, replacement: Document, options?: Document): LooseQuery;
  /**
   * Deletes one document and returns it.
   *
   * @param filter - The query filter.
   * @returns The query.
   */
  findOneAndDelete(filter: Document): LooseQuery;
  /**
   * Builds a hydrated document from a raw stored one.
   *
   * @param raw - The raw document.
   * @returns The document.
   */
  hydrate(raw: Document): LooseDoc;
  /**
   * Brings the collection's indexes in line with the schema.
   *
   * @param options - `dryRun` only reports.
   * @returns The sync report.
   */
  syncIndexes(options?: { readonly dryRun?: boolean }): Promise<unknown>;
  /**
   * Creates the schema's indexes.
   *
   * @returns The created index names.
   */
  createIndexes(): Promise<readonly string[]>;
}

/** Casts to the loose views. */
export class Loose {
  /**
   * The untyped view of a Typemo model.
   *
   * @param model - The typed model.
   * @returns The same object, loosely typed.
   */
  static typemo<T extends object>(model: Model<T>): LooseTypemoModel {
    return model as unknown as LooseTypemoModel;
  }

  /**
   * The untyped view of a document.
   *
   * @param value - A hydrated document.
   * @returns The same object, loosely typed.
   */
  static doc(value: unknown): LooseDoc {
    return value as LooseDoc;
  }

  /**
   * The untyped view of a list of documents.
   *
   * @param value - A list of hydrated documents.
   * @returns The same list, loosely typed.
   */
  static docs(value: unknown): LooseDoc[] {
    return value as LooseDoc[];
  }

  /**
   * Checks that a result is an array.
   *
   * @param value - A query result.
   * @returns The same array.
   * @throws Error - When the value is not an array.
   */
  static list(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error(`expected an array result, got ${typeof value}`);
    return value;
  }
}
