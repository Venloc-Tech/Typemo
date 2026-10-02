import { Entity, Prop, Schema, Timestamped, TypemoClient, Versioned } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "posts" })
class Post extends Timestamped(Versioned(Entity)) { // [!code highlight]
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => [String]) tags!: string[];
}

const Posts = client.db().model(Post);
const post = await Posts.create({ title: "a", tags: [] });
console.log(post.__v);
// → 0

post.tags.push("news");
await post.$save();
console.log(post.__v);
// → 1
