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
try {
  await Posts.keysetPage({ sort: [["views", "desc"]], limit: 3, after: "garbage" });
} catch (error) {
  console.log(String(error));
  // → "KeysetTokenError: keysetPage: invalid cursor — it cannot be read"
}
