/*
 * The operations of the document shape tests, written ONCE: the runtime test runs them on the server, the
 * type probe reads their result types from this module (`$toObject`, `$toJSON`, their options, lean, and the
 * forms of a document made from input: `create`, `insertMany`, `new`).
 */
import type { ObjectId } from "mongodb";
import type { Model } from "../../../src/index.ts";
import type { Order } from "./document-entities.ts";

/**
 * The operations whose result types the shape tests compare with the runtime rows.
 *
 * @param Orders - the order model
 * @param id - the `_id` of a stored order
 * @returns one lazy operation per case, keyed by name
 */
export const shapeDocuments = (Orders: Model<Order>, id: ObjectId) => ({
  plain: async () => (await Orders.findById(id).orFail()).$toObject(),
  plainOptions: async () =>
    (await Orders.findById(id).orFail()).$toObject({ virtuals: true, hidden: false, getters: true }),
  json: async () => (await Orders.findById(id).orFail()).$toJSON(),
  jsonOptions: async () => (await Orders.findById(id).orFail()).$toJSON({ virtuals: true }),
  transformed: async () =>
    (await Orders.findById(id).orFail()).$toObject({
      transform: (plain) => ({ who: plain.customer, n: plain.tags.length }),
    }),
  lean: () => Orders.findById(id).orFail().lean(),
  /* a document made from input keeps the Hidden values it was given (a read leaves them out) */
  createdField: async () => {
    const created = await Orders.create({ customer: "bob", tags: [], lines: [], secret: "s1" });
    return { secret: created.secret };
  },
  createdObject: async () => (await Orders.create({ customer: "bob", tags: [], lines: [], secret: "s1" })).$toObject(),
  createdPlain: async () => (await Orders.create({ customer: "bob", tags: [], lines: [], secret: "s1" })).$toPlain(),
  createdJson: async () => (await Orders.create({ customer: "bob", tags: [], lines: [], secret: "s1" })).$toJSON(),
  insertedObject: async () =>
    (await Orders.insertMany([{ customer: "bob", tags: [], lines: [], secret: "s1" }]))[0]?.$toObject(),
  /* an unsaved document: Hidden kept, no timestamps and no version until $save (optional in its type) */
  newObject: async () => Orders.new({ customer: "bob", tags: [], lines: [], secret: "s1" }).$toObject(),
  newSavedObject: async () =>
    (await Orders.new({ customer: "bob", tags: [], lines: [], secret: "s1" }).$save()).$toObject(),
});

/**
 * The operations object returned by `shapeDocuments`.
 *
 * @example
 * type Plain = Awaited<ReturnType<ShapeDocuments["plain"]>>;
 */
export type ShapeDocuments = ReturnType<typeof shapeDocuments>;
