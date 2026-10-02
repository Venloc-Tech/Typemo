import { Entity, Prop, Schema, ServerValidationError, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) score!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Posts = client.connection.model(Post);
// ---cut---
try {
  await Posts.create({ title: "z", score: 500 });
} catch (error) {
  if (error instanceof ServerValidationError) {
    console.log(error.message);
    // → the collection validator refused the document: Document failed validation
    console.log(error.code);
    // → 121
  }
}
