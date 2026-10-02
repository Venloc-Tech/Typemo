import { Entity, KeysetTokenError, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
  @Prop(() => Boolean) draft?: boolean;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Posts = client.db().model(Post);
declare class __BadRequest__ extends Error {}
// ---cut---
const page = await Posts.keysetPage({
  filter: { views: { $lt: 40 } },
  sort: [["views", "desc"]],
  limit: 2,
});
console.log(page.items.map((post) => post.title));
// → ["D", "E"]
