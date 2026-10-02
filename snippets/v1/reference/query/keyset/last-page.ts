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
const last = await Posts.keysetPage({ sort: [["views", "desc"]], limit: 7 });
console.log(last.items.length, last.hasMore, last.nextCursor);
// → 7 false null
