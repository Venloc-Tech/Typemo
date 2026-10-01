/*
 * Stress for the generic `then`: callbacks returning another query (a thenable → recursive
 * Awaited), long chains, Promise combinators, generic helpers over PromiseLike, Awaited<> of deep populate.
 */
import { CommentModel, PostModel, UserModel } from "../models.ts";

export const s01 = () =>
  UserModel.findOne({ name: "a" })
    .orFail()
    .then((u) => PostModel.find({ author: u._id }).populate("comments.author").populate("author").lean());
export const s02 = () =>
  PostModel.find()
    .populate("comments.author.posts")
    .populate("coAuthors")
    .lean()
    .then((posts) => posts.map((p) => p.comments[0]?.author?.posts[0]?.title))
    .then((titles) => titles.filter((t): t is string => t !== undefined))
    .catch(() => [] as string[])
    .finally(() => undefined);
export const s03 = async () => {
  const settled = await Promise.allSettled([
    UserModel.find().populate("posts.comments.author").populate("bestFriend").lean(),
    CommentModel.find().populate("post.author").populate("replies.author").lean(),
    PostModel.findOne().populate("revisions.editor").orFail(),
  ]);
  const first = settled[0];
  return first.status === "fulfilled" ? first.value[0]?.posts[0]?.comments[0]?.author?.name : undefined;
};
export const s04 = () =>
  Promise.race([UserModel.findOne().populate("bestFriend").lean(), PostModel.findOne().populate("author").lean()]);
const run = <Q extends PromiseLike<unknown>>(q: Q): Promise<Awaited<Q>> => Promise.resolve(q) as Promise<Awaited<Q>>;
export const s05 = () =>
  run(UserModel.find().populate("posts.comments.author.bestFriend").populate("followers").lean());
export type S06 = NonNullable<
  Awaited<ReturnType<typeof s05>>[number]["posts"][number]["comments"][number]["author"]
>["bestFriend"];
export const s07 = async () =>
  UserModel.findOne().populate("posts.related.author").populate("pinnedComment.author").orFail();
export const s08 = async () => {
  const u = await s07();
  const p = await PostModel.findById(u.posts[0]?._id ?? u._id)
    .populate("comments.replies.author")
    .then((post) => post?.comments[0]?.replies[0]?.author?.name);
  return p;
};
