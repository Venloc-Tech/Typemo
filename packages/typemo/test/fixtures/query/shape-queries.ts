/*
 * The queries of the query shape tests, written ONCE: the runtime test runs them, the type probe reads
 * their result types (`Awaited<ReturnType<…>>`) from this same module.
 */
import type { models } from "./seed.ts";
import { IDS } from "./seed.ts";

/**
 * The models object of the seed.
 *
 * @example
 * const { Members }: Models = models(() => db);
 */
export type Models = ReturnType<typeof models>;

/**
 * The queries whose result types the shape tests compare with the runtime rows.
 *
 * @param models - the member, article and note models
 * @returns one lazy query per case, keyed by name
 */
export const shapeQueries = ({ Members, Articles, Notes }: Models) => ({
  leanDefault: () => Members.findById(IDS.ann).orFail().lean(),
  leanMinimal: () => Members.findById(IDS.eve).orFail().lean(),
  plusHidden: () => Members.findById(IDS.ann).select({ "+passwordHash": true }).orFail().lean(),
  inclusion: () => Members.findById(IDS.ann).select({ name: 1, tags: 1, _id: 0 }).orFail().lean(),
  dotted: () => Members.findById(IDS.ann).select({ "profile.address.city": 1 }).orFail().lean(),
  exclusion: () => Members.findById(IDS.bob).select({ profile: 0, counters: 0, badges: 0 }).orFail().lean(),
  idOnly: () => Members.findById(IDS.bob).select({ _id: 1 }).orFail().lean(),
  article: () => Articles.findById(IDS.first).orFail().lean(),
  populateRef: () => Members.findById(IDS.ann).populate("bestFriend").orFail().lean(),
  populateArray: () =>
    Members.findById(IDS.ann)
      .populate({ path: "favorites", select: { title: 1, views: 1 } })
      .orFail()
      .lean(),
  /* masked results — the type of `.mask()` against the masked rows */
  maskedLean: () =>
    Members.findById(IDS.ann)
      .orFail()
      .lean()
      .mask({ name: "mask", email: (email: string) => email.length }),
  maskedPopulate: () =>
    Members.findById(IDS.ann).populate("bestFriend").orFail().lean().mask({ "bestFriend.name": "mask" }),
  populateVirtual: () => Articles.findById(IDS.first).populate("notes").orFail().lean(),
  narrowed: () => Members.find().where("role").in(["admin", "editor"]).where("age").exists().lean(),
  textScore: () =>
    Articles.find({ $text: { $search: "typed" } })
      .select({ title: 1 })
      .textScore("relevance")
      .lean(),
  modified: () =>
    Members.findOneAndUpdate({ _id: IDS.bob }, { $inc: { age: 1 } })
      .orFail()
      .lean(),
  exists: () => Members.exists({ name: "Bob" }),
  distinctTags: () => Members.distinct("tags"),
  count: () => Notes.countDocuments({ score: { $gt: 1 } }),
  updated: () => Members.updateOne({ _id: IDS.bob }, { $set: { active: true } }),
  deleted: () => Notes.deleteMany({ score: { $lt: 0 } }),
  metadata: () =>
    Members.findOneAndUpdate({ _id: IDS.bob }, { $set: { active: true } })
      .lean()
      .includeResultMetadata(),
});

/**
 * The queries object returned by `shapeQueries`.
 *
 * @example
 * type Row = Awaited<ReturnType<ShapeQueries["leanDefault"]>>;
 */
export type ShapeQueries = ReturnType<typeof shapeQueries>;
