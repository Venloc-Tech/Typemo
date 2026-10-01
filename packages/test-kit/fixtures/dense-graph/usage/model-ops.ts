/*
 * Operations of `Model<T>` on the dense graph (10 chains): create/insertMany inputs, bulkWrite
 * operations, find-and-modify by id, aggregation rows, a typed cursor map.
 */

import { fn } from "@venloc/typemo";
import type { ObjectId } from "mongodb";
import { PostStore, UserStore } from "../models.ts";

declare const id: ObjectId;

export const modelOps = async () => {
  const created = await UserStore.create({
    name: "a",
    email: "a@b",
    passwordHash: "x",
    profile: { links: [] } as never,
    tags: [],
    posts: [],
    bestFriend: null,
    followers: [],
    counters: new Map(),
    badges: new Map(),
  });
  const many = await UserStore.insertMany([]);
  const bulk = await UserStore.bulkWrite([
    { updateOne: { filter: { name: "a" }, update: { $inc: { age: 1 } } } },
    { deleteMany: { filter: { role: "user", age: { $lt: 18 } } } },
  ]);
  const byId = await UserStore.findByIdAndUpdate(id, { $set: { age: 3 } }).lean();
  const removed = await PostStore.findByIdAndDelete(id).lean();
  const rows = await UserStore.aggregate((p) =>
    p.match({ active: true }).group((f) => ({ _id: f.role, n: fn.sum(1) })),
  );
  const names = UserStore.find({ role: "admin" })
    .lean()
    .cursor()
    .map((user) => user.name);
  const first = await names.next();
  const counted = await PostStore.countDocuments({ title: /x/ });
  const upserted = await UserStore.updateOne({ email: "a@b" }, { $set: { name: "b" } }, { upsert: true });
  return [
    created.name,
    many.length,
    bulk.insertedCount,
    byId?.name,
    removed?._id,
    rows[0]?.n,
    first,
    counted,
    upserted.upsertedId,
  ] as const;
};
