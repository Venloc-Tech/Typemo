import { Entity, Prop, Schema, Timestamped, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Timestamped(Entity) {
  @Prop(() => String, { required: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Posts = client.db().model(Post);
// ---cut---
const post = await Posts.create({ title: "Hello" });
console.log(post.createdAt.getTime() === post.updatedAt.getTime());
// → true

post.title = "Hello, world";
await post.$save();
console.log(post.updatedAt.getTime() > post.createdAt.getTime());
// → true
