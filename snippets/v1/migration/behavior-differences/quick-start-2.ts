import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number) views?: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Posts = client.db().model(Post);
// ---cut---
await Posts.create({ title: "Hello", views: 42 });
await Posts.updateOne({ title: "Hello" }, { $set: { views: 10 } });
const post = await Posts.findOneAndUpdate({ title: "Hello" }, { $inc: { views: 1 } });
console.log(post?.views);
// → 11
