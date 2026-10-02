import { Entity, Prop, Schema, Timestamped, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
@Schema()
class Post extends Timestamped(Entity) {
  @Prop(() => String)
  title?: string;
}
const Posts = client.db().model(Post);
// ---cut---
const past = new Date("2001-02-03T04:05:06.000Z");
const imported = await Posts.create({ title: "old", createdAt: past, updatedAt: past }); // [!code highlight]
console.log(imported.createdAt.toISOString(), imported.updatedAt.toISOString());
// → 2001-02-03T04:05:06.000Z 2001-02-03T04:05:06.000Z

await Posts.updateOne({ _id: imported._id }, { $set: { title: "older" } });
const moved = await Posts.findById(imported._id).orFail();
console.log(moved.createdAt.toISOString(), moved.updatedAt.getTime() > past.getTime());
// → 2001-02-03T04:05:06.000Z true
