import { Entity, Keyset, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
  @Prop(() => Number) rating?: number;
  @Prop(() => String, { nullable: true }) topic!: string | null;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Posts = client.db().model(Post);
// ---cut---
const first = await Posts.keysetPage({ sort: [["views", "desc"]], limit: 3 });
console.log(first.items.map((post) => post.title), first.hasMore);
// → ["A", "C", "B"] true

const second = await Posts.keysetPage({ sort: [["views", "desc"]], limit: 3, after: first.nextCursor });
console.log(second.items.map((post) => post.title), second.hasMore);
// → ["D", "E", "G"] true
