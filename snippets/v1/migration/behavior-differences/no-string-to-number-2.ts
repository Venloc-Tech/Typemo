import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number) views?: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Posts = client.db().model(Post);
// ---cut---
// @errors: 2769
await Posts.create({ title: "Hello", views: "42" });
// compiler: No overload matches this call (Type 'string' is not assignable to type 'number')
// at runtime: Cast to number failed at path "views" for "42" (string): expected a number [type]
