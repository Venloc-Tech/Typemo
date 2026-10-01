/*
 * Deep populate on the cyclic graph: dotted string paths up to depth 7, nested object form, array form,
 * repeated populate, destructuring, reading deep fields.
 */
import { CommentModel, PostModel, UserModel } from "../models.ts";

export const d01 = () => UserModel.find().populate("posts.comments.author").lean();
export const d02 = () => UserModel.find().populate("posts.comments.author.posts.comments.author.bestFriend").lean();
export const d03 = () => PostModel.find().populate("comments.replies.author.posts.related.author").lean();
export const d04 = () => CommentModel.find().populate("post.author.followers").populate("replies.author").lean();
export const d05 = () =>
  PostModel.findOne({ slug: "a" })
    .populate({ path: "comments", select: { body: 1, author: 1 }, populate: { path: "author", select: { name: 1 } } })
    .orFail();
export const d06 = () => UserModel.find().populate(["posts", "bestFriend", "followers"]).lean();
export const d07 = () => UserModel.find().populate("badges.$*.awardedBy").lean();
export const d08 = () => CommentModel.find().populate("mentions.$*").lean();
export const d09 = () => PostModel.find().populate("revisions.editor.posts").select({ title: 1, revisions: 1 }).lean();
export const d10 = () => UserModel.find().populate("commentsByUser.post.author").populate("postCount").lean();

export const readDeep = async (): Promise<number> => {
  const [first] = await d02();
  const deepName = first?.posts[0]?.comments[0]?.author?.posts[0]?.comments[0]?.author?.bestFriend?.name;
  const post = await d05();
  const commentAuthor: string | undefined = post.comments[0]?.author?.name;
  const [x] = await d04();
  const followers = x?.post?.author?.followers.length ?? 0;
  const count = (await d10())[0]?.postCount;
  return (deepName?.length ?? 0) + (commentAuthor?.length ?? 0) + followers + (count ?? 0);
};
