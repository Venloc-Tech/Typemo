import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Posts = client.db().model(Post);
// ---cut---
const byTitle = await Posts.find().sort({ title: -1 }).limit(3).plain();
console.log(byTitle.map((post) => post.title));
// → ["G", "F", "E"]

const byViews = await Posts.find().sort({ views: -1, title: 1 }).plain();
console.log(byViews.map((post) => post.title));
// → ["A", "B", "C", "D", "E", "F", "G"]
