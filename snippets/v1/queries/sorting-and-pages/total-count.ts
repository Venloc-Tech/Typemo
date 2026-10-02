import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Posts = client.db().model(Post);
// ---cut---
export const listPosts = async (page: number, perPage: number) => {
  const [items, total] = await Promise.all([
    Posts.find()
      .sort({ views: -1, _id: 1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .plain(),
    Posts.countDocuments(),
  ]);
  return { items, total, pages: Math.ceil(total / perPage) };
};

const result = await listPosts(2, 3);
console.log(result.items.map((post) => post.title), result.total, result.pages);
// → ["D", "E", "F"] 7 3
