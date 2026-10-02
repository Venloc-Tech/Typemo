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
  await Posts.insertMany(
    [{ title: "e" }, { views: 5 } as unknown as { title: string }, { title: "f" }],
    { ordered: false },
  );
} catch (error) {
  console.log((error as Error).message);
}
// → Post.insertMany: 1 write(s) failed (first at index 1: Validation failed: "title": the field is required [required])
