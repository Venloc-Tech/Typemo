import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Posts = client.db().model(Post);
// ---cut---
const top = await Posts.find().sort({ views: -1, _id: 1 }).limit(3).plain();
console.log(top.map((post) => post.title));
// → ["A", "B", "C"]

console.log(await Posts.countDocuments());
// → 7
