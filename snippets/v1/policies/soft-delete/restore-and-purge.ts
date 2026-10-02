import { Entity, Prop, Schema, TypemoClient, SoftDelete } from "@venloc/typemo";
@Schema({ collection: "posts", softDelete: true })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Posts = client.connection.model(Post);
// ---cut---
await Posts.deleteOne({ title: "Three" });
const purged = await SoftDelete.purge(Posts, { title: "Three" });
console.log(purged.deletedCount);
// → 1

const live = await SoftDelete.purge(Posts, { title: "One" });
console.log(live.deletedCount);
// → 0
