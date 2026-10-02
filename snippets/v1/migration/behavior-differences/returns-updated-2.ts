import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number) views?: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Posts = client.db().model(Post);
// ---cut---
const after = await Posts.findOneAndUpdate({ title: "a" }, { $inc: { views: 1 } });
const before = await Posts.findOneAndUpdate(
  { title: "a" },
  { $inc: { views: 1 } },
  { returnDocument: "before" },
);
