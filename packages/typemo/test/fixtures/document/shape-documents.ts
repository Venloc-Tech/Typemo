/*
 * The operations of the document shape tests, written ONCE: the runtime test runs them on the server, the
 * type probe reads their result types from this module (`$toObject`, `$toJSON`, their options, lean).
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
});

/**
 * The operations object returned by `shapeDocuments`.
 *
 * @example
 * type Plain = Awaited<ReturnType<ShapeDocuments["plain"]>>;
 */
export type ShapeDocuments = ReturnType<typeof shapeDocuments>;
