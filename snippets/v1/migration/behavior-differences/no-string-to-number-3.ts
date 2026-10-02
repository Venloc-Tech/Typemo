import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number) views?: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Posts = client.db().model(Post);
// ---cut---
try {
  await Posts.create({ title: "Hello", views: null as unknown as number });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to number failed at path "views" for null: null is not allowed on a path that is not nullable [null]
