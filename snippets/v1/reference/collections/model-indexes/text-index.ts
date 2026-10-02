import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
@Index({ title: "text", body: "text" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) body!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Posts = client.connection.model(Post);
// ---cut---
console.log((await Posts.diffIndexes()).toCreate);
// → ["title_text_body_text"]

await Posts.syncIndexes();
console.log(await Posts.diffIndexes());
// → { toCreate: [], toDrop: [], toModify: [] }
