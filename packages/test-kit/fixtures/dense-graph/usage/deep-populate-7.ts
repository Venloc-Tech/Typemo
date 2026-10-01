/* Regression for TS2589 (excessively deep instantiation): lean populate of depth 7 in a FRESH file. */
import { UserModel } from "../models.ts";

export const deep = async () => {
  const [u] = await UserModel.find().populate("posts.comments.author.posts.comments.author.bestFriend").lean();
  return u?.posts[0]?.comments[0]?.author?.posts[0]?.comments[0]?.author?.bestFriend?.name;
};
