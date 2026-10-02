import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Posts = client.db().model(Post);
// ---cut---
const last = await Posts.find().sort({ views: -1, _id: 1 }).skip(6).limit(3).plain();
console.log(last.map((post) => post.title));
// → ["G"]

const beyond = await Posts.find().sort({ views: -1, _id: 1 }).skip(60).limit(3).plain();
console.log(beyond.length);
// → 0
