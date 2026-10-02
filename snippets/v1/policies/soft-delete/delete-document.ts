import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts", softDelete: true })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Posts = client.connection.model(Post);
// ---cut---
const first = await Posts.deleteOne({ title: "Two" });
console.log(first.deletedCount);
// → 1

const again = await Posts.deleteMany({ title: "Two" });
console.log(again.deletedCount);
// → 0
