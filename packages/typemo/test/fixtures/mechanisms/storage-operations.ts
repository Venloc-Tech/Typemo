/*
 * The storage operations of the shape tests and the runtime tests, written ONCE: the runtime test runs
 * them on the server, the type probe reads their result types from this module.
 */
import { type Connection, fn, Materialized, type Model, TypedView } from "../../../src/index.ts";
import { Animal, AnimalName, Article, type Imaged, StateTotal, TitleScore, TopArticle } from "./storage-entities.ts";

/**
 * A view of the articles that scored at least 5.
 *
 * @param connection - the connection that owns the view
 * @returns the typed view definition
 */
export const topArticles = (connection: Connection) =>
  TypedView.define(connection, TopArticle, {
    on: Article,
    pipeline: (p) => p.match({ score: { $gte: 5 } }).project({ title: 1, score: 1 }),
  });

/**
 * A view of the animals that have a name (the animals are a discriminated collection).
 *
 * @param connection - the connection that owns the view
 * @returns the typed view definition
 */
export const animalNames = (connection: Connection) =>
  TypedView.define(connection, AnimalName, { on: Animal, pipeline: (p) => p.match({ name: { $exists: true } }) });

/**
 * A materialized collection of the score and article count per state (merge mode).
 *
 * @param connection - the connection that owns the collection
 * @returns the materialized definition
 */
export const stateTotals = (connection: Connection) =>
  Materialized.define(connection, StateTotal, {
    from: Article,
    pipeline: (p) => p.group((f) => ({ _id: f.state, total: fn.sum(f.score), count: fn.sum(1) })),
  });

/**
 * The same totals as `stateTotals`, written in replace mode.
 *
 * @param connection - the connection that owns the collection
 * @returns the materialized definition
 */
export const stateTotalsReplace = (connection: Connection) =>
  Materialized.define(connection, StateTotal, {
    from: Article,
    mode: "replace",
    pipeline: (p) => p.group((f) => ({ _id: f.state, total: fn.sum(f.score), count: fn.sum(1) })),
  });

/**
 * A materialized collection keyed by article title instead of `_id`.
 *
 * @param connection - the connection that owns the collection
 * @returns the materialized definition
 */
export const titleScores = (connection: Connection) =>
  Materialized.define(connection, TitleScore, {
    from: Article,
    on: "title",
    pipeline: (p) => p.project({ _id: 0, title: 1, score: 1 }),
  });

/**
 * The next event of `kind` after `write` (the cursor is opened first).
 *
 * @param stream - the change stream to read
 * @param kind - the expected `operationType`
 * @param write - the write that produces the event
 * @returns the event, narrowed to `kind`
 * @throws when the next event is of another kind
 */
const eventAfter = async <E extends { readonly operationType: string }, K extends E["operationType"]>(
  stream: { next(): Promise<E>; close(): Promise<void> },
  kind: K,
  write: () => PromiseLike<unknown>,
): Promise<Extract<E, { readonly operationType: K }>> => {
  await write();
  const event = await stream.next();
  await stream.close();
  if (event.operationType !== kind) throw new Error(`expected ${kind}, got ${event.operationType}`);
  /* cast: the operationType was checked against `kind` above */
  return event as Extract<E, { readonly operationType: K }>;
};

/**
 * The operations whose result types the shape tests compare with the runtime rows.
 *
 * @param connection - the connection of the views and materialized collections
 * @param Articles - the article model
 * @param Imageds - the model of the collection with change-stream pre/post images
 * @returns one lazy operation per case, keyed by name
 */
export const storageOperations = (connection: Connection, Articles: Model<Article>, Imageds: Model<Imaged>) => ({
  viewRows: () => topArticles(connection).find().sort({ score: -1 }),
  viewOne: () => topArticles(connection).findOne({ title: "b" }),
  materializedRows: () => stateTotals(connection).model.find().lean(),
  keysetLean: () => Articles.keysetPage({ sort: [["publishedAt", -1]], limit: 2, lean: true }),
  keysetHydrated: () => Articles.keysetPage({ sort: [["score", 1]], limit: 2, filter: { state: "live" } }),
  insertEvent: async () => eventAfter(await Imageds.watch(), "insert", () => Imageds.create({ name: "e", n: 1 })),
  updateEvent: async () => {
    const doc = await Imageds.create({ name: "u", n: 1 });
    return eventAfter(
      await Imageds.watch({ fullDocument: "required", fullDocumentBeforeChange: "required" }),
      "update",
      () => Imageds.updateOne({ _id: doc._id }, { $set: { n: 2 } }),
    );
  },
  deleteEvent: async () => {
    const doc = await Imageds.create({ name: "d", n: 1 });
    return eventAfter(await Imageds.watch(), "delete", () => Imageds.deleteOne({ _id: doc._id }));
  },
});

/**
 * The operations object returned by `storageOperations`.
 *
 * @example
 * type Row = Awaited<ReturnType<StorageOperations["viewOne"]>>;
 */
export type StorageOperations = ReturnType<typeof storageOperations>;
