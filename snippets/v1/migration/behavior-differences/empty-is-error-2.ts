import { Entity, Filters, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number) views?: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Posts = client.db().model(Post);
// ---cut---
// empty update: QueryError "update: an empty update changes nothing"
// update without an operator: QueryError
//   "update: \"views\" is not an update operator (write { $set: { … } })"
// an empty filter in any of the five writes (updateOne, updateMany, deleteOne, deleteMany, replaceOne):
// StrictModeError before reaching the database, for example
//   "deleteOne with an empty filter would change or remove an arbitrary document; pass a filter,
//    or Filters.all() to mean every document on purpose [empty-filter]"

// deleting every document is allowed, but only on purpose:
await Posts.deleteMany(Filters.all());
