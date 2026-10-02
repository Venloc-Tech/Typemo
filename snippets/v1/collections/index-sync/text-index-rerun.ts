import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
@Index({ title: "text", body: "text" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) body!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
client.connection.model(Post);
// ---cut---
const first = await client.connection.init();
console.log(first.created);
// → ["collection posts", "index posts.title_text_body_text"]

const second = await client.connection.init();
console.log(second.inSync, second.created);
// → true []
