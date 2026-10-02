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
const first = await Posts.keysetPage({ sort: [["views", "desc"]], limit: 2 });
console.log(first.items.map((post) => post.title));
// → ["A", "C"]

await Posts.create({ title: "Z", views: 100 });

const second = await Posts.keysetPage({ sort: [["views", "desc"]], limit: 2, after: first.nextCursor });
console.log(second.items.map((post) => post.title));
// → ["B", "D"]
