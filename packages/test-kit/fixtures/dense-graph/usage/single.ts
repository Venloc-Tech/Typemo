/* One realistic query: filter + select + populate + lean. */
import { UserModel } from "../models.ts";

export const single = async (): Promise<string | undefined> => {
  const users = await UserModel.find({ role: { $in: ["admin", "editor"] }, "profile.address.city": "Paris" })
    .select({ name: 1, email: 1, posts: 1 })
    .populate("posts")
    .lean();
  return users[0]?.posts[0]?.title;
};
