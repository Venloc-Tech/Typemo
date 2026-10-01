/*
 * 50 realistic queries over the graph: filters (dotted, operators, $or), updates, select chains,
 * shallow populate, lean/orFail. Deep populate lives in deep-populate.ts. Selects are objects, not strings.
 */
import { ObjectId } from "mongodb";
import { CommentModel, MentionModel, NotificationModel, PostModel, UserModel } from "../models.ts";

const id = new ObjectId();

export const q01 = () => UserModel.find({ age: { $gte: 18, $lt: 65 } }).lean();
export const q02 = () => UserModel.findOne({ email: "a@b.c" }).orFail();
export const q03 = () => UserModel.find({ "profile.address.city": { $in: ["Paris", "Berlin"] } }).select({ name: 1 });
export const q04 = () =>
  UserModel.find({ $or: [{ role: "admin" }, { age: { $gt: 60 } }] })
    .sort({ name: 1 })
    .limit(10);
export const q05 = () => UserModel.find({ tags: "vip" }).select({ name: 1, tags: 1, _id: 0 }).lean();
export const q06 = () => UserModel.find({ tags: { $all: ["a", "b"] } }).select({ name: 1, email: 1 });
export const q07 = () => UserModel.findById(id).populate("bestFriend").lean();
export const q08 = () => UserModel.find({ "profile.settings.theme": "dark" }).select({ "profile.settings": 1 });
export const q09 = () => UserModel.find({ "profile.links.url": { $regex: /github/ } }).lean();
export const q10 = () => UserModel.find({ "counters.visits": { $gt: 10 } }).select({ name: 1, counters: 1 });
export const q11 = () => UserModel.updateOne({ _id: id }, { $set: { name: "x", "profile.bio": "y" } });
export const q12 = () => UserModel.updateOne({ _id: id }, { $inc: { age: 1 }, $push: { tags: "new" } });
export const q13 = () => UserModel.updateMany({ role: "user" }, { $set: { active: false } });
export const q14 = () => UserModel.updateOne({ _id: id }, { $addToSet: { followers: id }, $pull: { posts: id } });
export const q15 = () => UserModel.updateOne({ _id: id }, { $set: { "posts.$": id } });
export const q16 = () => UserModel.find({ bestFriend: null }).select({ name: 1, bestFriend: 1 }).populate("bestFriend");
export const q17 = () => UserModel.find().select({ name: 1 }).select({ email: 1 }).lean();
export const q18 = () => UserModel.find().select({ profile: 0, counters: 0, badges: 0 }).lean();
export const q19 = () => UserModel.findOne({ name: "n" }).populate("pinnedComment").orFail().lean();
export const q20 = () =>
  UserModel.find({
    "profile.address.geo": { $near: { $geometry: { type: "Point", coordinates: [2.35, 48.85] } } },
  }).sort({ "profile.address.city": -1 });
export const q21 = () => PostModel.find({ status: "published" }).sort({ publishedAt: -1 }).limit(20).lean();
export const q22 = () => PostModel.findOne({ slug: "hello" }).populate("author").orFail();
export const q23 = () => PostModel.find({ author: id }).select({ title: 1, slug: 1 }).lean();
export const q24 = () => PostModel.find({ "meta.views": { $gte: 100 } }).select({ title: 1, meta: 1 });
export const q25 = () => PostModel.find({ "meta.seo.keywords": "mongo" }).lean();
export const q26 = () => PostModel.find({ "revisions.editor": id }).select({ revisions: 1 });
export const q27 = () => PostModel.find({ "blocks.kind": "image", "blocks.url": { $regex: "^https" } }).lean();
export const q28 = () => PostModel.find({ tags: { $size: 3 } }).select({ title: 1, tags: 1 });
export const q29 = () => PostModel.find({ $and: [{ status: "draft" }, { "meta.likes": { $lt: 5 } }] });
export const q30 = () => PostModel.updateOne({ _id: id }, { $inc: { "meta.views": 1 } });
export const q31 = () =>
  PostModel.updateOne(
    { _id: id },
    { $push: { revisions: { editor: id, at: new Date(), diff: { added: 1, removed: 0, files: [] } } } },
  );
export const q32 = () =>
  PostModel.updateOne(
    { _id: id },
    { $set: { "revisions.$[r].note": "fixed" } },
    { arrayFilters: [{ "r.at": { $lt: new Date() } }] },
  );
export const q33 = () =>
  PostModel.updateMany({ status: "draft" }, { $set: { status: "archived" }, $unset: { "meta.seo.og.image": 1 } });
export const q34 = () => PostModel.find().populate(["author", "coAuthors"]).lean();
export const q35 = () => PostModel.find().populate("comments").select({ title: 1, comments: 1 });
export const q36 = () => PostModel.findById(id).populate("topComment").lean();
export const q37 = () => PostModel.find({ "reactions.like": { $gte: 1 } }).lean();
export const q38 = () =>
  PostModel.find({ publishedAt: { $exists: true } })
    .select({ title: 1, publishedAt: 1 })
    .orFail();
export const q39 = () => CommentModel.find({ post: id }).sort({ score: -1 }).limit(50).lean();
export const q40 = () => CommentModel.find({ parent: null }).populate("author").lean();
export const q41 = () => CommentModel.find({ "reactions.kind": "love" }).select({ body: 1, reactions: 1 });
export const q42 = () => CommentModel.findOne({ _id: id }).populate("replies").orFail();
export const q43 = () => CommentModel.updateOne({ _id: id }, { $inc: { score: 1 }, $set: { edited: true } });
export const q44 = () => CommentModel.updateOne({ _id: id }, { $pull: { reactions: { kind: "angry" } } });
export const q45 = () => CommentModel.find({ "mentions.alice": id }).lean();
export const q46 = () =>
  CommentModel.find({ body: { $regex: "hi", $options: "i" } })
    .select({ body: 1, author: 1 })
    .populate("author");
export const q47 = () => MentionModel.find({ read: false }).populate("comment").lean();
export const q48 = () => MentionModel.updateMany({ recipient: id }, { $set: { read: true } });
export const q49 = () => NotificationModel.find({ kind: "follow" }).lean();
export const q50 = () =>
  UserModel.find({ "badges.gold": { $exists: true } })
    .select({ badges: 1 })
    .lean();

export const consume = async (): Promise<number> => {
  const a = await q01();
  const b = await q02();
  const c = await q22();
  const d = await q34();
  const e = await q47();
  const f = await q19();
  return (
    a.length + b.name.length + (c.author?.name.length ?? 0) + (d[0]?.coAuthors.length ?? 0) + e.length + f.name.length
  );
};
