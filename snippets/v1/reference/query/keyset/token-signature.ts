import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
}

// ---cut---
const client = await TypemoClient.connect("mongodb://localhost:27017", {
  dbName: "app",
  keysetSecret: "__a-secret-of-at-least-32-bytes-long__",
});
const Posts = client.db().model(Post);

const first = await Posts.keysetPage({ sort: [["views", "desc"]], limit: 3 });
console.log(first.nextCursor?.includes("."));
// → true
