import { Entity, Prop, Schema, Timestamped, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Timestamped(Entity) {
  @Prop(() => String, { required: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Posts = client.db().model(Post);
// ---cut---
const post = await Posts.create({ title: "a" });
await Posts.updateOne({ _id: post._id }, { $set: { title: "b" } });
const reread = await Posts.findById(post._id).orFail();
console.log(reread.createdAt.getTime() === post.createdAt.getTime(), reread.updatedAt.getTime() >= post.updatedAt.getTime());
// → true true
