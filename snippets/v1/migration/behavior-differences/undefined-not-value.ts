import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number) views?: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Posts = client.db().model(Post);
const maybeViews = undefined as number | undefined;
// ---cut---
// @errors: 2379
try {
  await Posts.find({ views: maybeViews });
} catch (error) {
  console.log((error as Error).message);
}
// compiler: Type 'undefined' is not assignable to type 'number | ScalarOperators<number, never>'
// at runtime (the value came from untyped JavaScript): filter: undefined at "views" (use $exists: false / $unset; undefined is never a value)
