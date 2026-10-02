import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Posts = client.db().model(Post);
// ---cut---
// @errors: 2769
await Posts.create({ title: "d", extra: 1 });
// compiler: No overload matches this call (Object literal may only specify known properties, and 'extra' does not exist in type 'CreateInput<Post>')
// at runtime: Cast to Post failed at path "extra" for 1 (number): not a field of Post [unknown-key]
