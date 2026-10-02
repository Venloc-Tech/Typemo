import { Entity, Prop, Schema, TypemoClient, SoftDelete } from "@venloc/typemo";
@Schema({ collection: "posts", softDelete: true })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Posts = client.connection.model(Post);
// ---cut---
await Posts.deleteOne({ title: "Two" });
console.log(await Posts.countDocuments());
// → 2

const result = await SoftDelete.restore(Posts, { title: "Two" });
console.log(result.matchedCount, result.modifiedCount);
// → 1 1
console.log(await Posts.countDocuments());
// → 3
