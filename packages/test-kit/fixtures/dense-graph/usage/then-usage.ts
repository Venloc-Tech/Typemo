/* How a query is consumed besides `await`: `.then(cb)`, `.catch`, `Promise.all`, `Awaited<>`. */
import { PostModel, UserModel } from "../models.ts";

export const t01 = async () => {
  const names = await UserModel.find({ active: true })
    .select({ name: 1 })
    .lean()
    .then((users) => users.map((u) => u.name));
  return names;
};
export const t02 = () =>
  PostModel.findOne({ slug: "a" })
    .populate("author")
    .orFail()
    .then((post) => post.author?.name ?? "");
export const t03 = async () => {
  const [users, posts] = await Promise.all([
    UserModel.find().populate(["posts", "bestFriend"]).lean(),
    PostModel.find().populate("comments.author").lean(),
  ]);
  return users.length + posts.length;
};
export const t04 = () =>
  UserModel.find()
    .populate("posts.comments.author")
    .lean()
    .catch(() => []);
type Row = Awaited<ReturnType<typeof t02>>;
export const t05 = (row: Row): string => row;
export const t06 = async () => UserModel.findOne({ name: "x" }).populate("bestFriend").lean();
