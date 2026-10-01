/*
 * The operations of the model shape tests, written ONCE: the runtime test runs them through a real
 * model (the operation pipeline), the type probe reads their result types from this module.
 */
import { ObjectId } from "mongodb";
import { fn, type Model } from "../../../src/index.ts";
import type { Order, Person } from "./model-entities.ts";

/** Fixed ids of the seeded documents. */
export const SHAPE_IDS = { ann: new ObjectId(), order: new ObjectId() } as const;

/**
 * The operations whose result types the shape tests compare with the runtime rows.
 *
 * @param People - the person model
 * @param Orders - the order model
 * @returns one lazy operation per case, keyed by name
 */
export const shapeOperations = (People: Model<Person>, Orders: Model<Order>) => ({
  created: () =>
    People.create({ name: "Cy", email: "cy@x.test", tags: ["t"], pets: [{ name: "Rex", age: 2 }], lastSeen: null }),
  inserted: () => People.insertMany([{ name: "Di", email: "di@x.test", tags: [], pets: [], lastSeen: null }]),
  leanFound: () => People.findById(SHAPE_IDS.ann).orFail().lean(),
  modified: () =>
    People.findByIdAndUpdate(SHAPE_IDS.ann, { $set: { age: 41 } })
      .orFail()
      .lean(),
  updated: () => People.updateOne({ _id: SHAPE_IDS.ann }, { $set: { age: 42 } }),
  deleted: () => Orders.deleteMany({ total: { $lt: 0 } }),
  bulk: () =>
    People.bulkWrite([
      { insertOne: { document: { name: "Ed", email: "ed@x.test", tags: [], pets: [], lastSeen: null } } },
      { updateOne: { filter: { email: "new@x.test" }, update: { $set: { name: "N" } }, upsert: true } },
    ]),
  grouped: () => Orders.aggregate((p) => p.group((f) => ({ _id: f.status, total: fn.sum(f.total), count: fn.sum(1) }))),
  exists: () => People.exists({ name: "Ann" }),
  distinct: () => People.distinct("role"),
});

/**
 * The operations object returned by `shapeOperations`.
 *
 * @example
 * type Row = Awaited<ReturnType<ShapeOperations["leanFound"]>>;
 */
export type ShapeOperations = ReturnType<typeof shapeOperations>;
