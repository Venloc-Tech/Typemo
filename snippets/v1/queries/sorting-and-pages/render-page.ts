import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Posts = client.db().model(Post);
// ---cut---
const page = 2;
const perPage = 3;

const items = await Posts.find()
  .sort({ views: -1, _id: 1 })
  .skip((page - 1) * perPage)
  .limit(perPage)
  .plain();
console.log(items.map((post) => post.title));
// → ["D", "E", "F"]
