import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Posts = client.db().model(Post);
// ---cut---
const MAX_PER_PAGE = 50;

// a paged list of posts, with the total count
export const listPosts = async (pageParam: string | undefined, perPageParam: string | undefined) => {
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number.parseInt(perPageParam ?? "20", 10) || 20));

  const [items, total] = await Promise.all([
    // the order is total: _id is the last key
    Posts.find()
      .sort({ views: -1, _id: 1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .plain(),
    Posts.countDocuments(),
  ]);

  return { items, total, page, pages: Math.ceil(total / perPage) };
};

// the most popular post
export const topPost = () => Posts.findOne().sort({ views: -1, _id: 1 }).plain().orFail();
