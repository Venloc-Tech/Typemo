import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { min: 10 }) views?: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Posts = client.db().model(Post);
// ---cut---
const post = Posts.new({ title: "t" });
// @errors: 2322
post.views = "abc";
// compiler: Type 'string' is not assignable to type 'number'
// at runtime (the value came without types), on $validate() or $save():
//   CastError: Cast to number failed at path "views" for "abc" (string): expected a number [type]
