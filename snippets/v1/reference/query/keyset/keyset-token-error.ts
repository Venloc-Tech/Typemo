import { KeysetTokenError } from "@venloc/typemo";
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
declare class __BadRequest__ extends Error {}
// ---cut---
export const listPosts = async (afterFromUrl: string | null) => {
  try {
    return await Posts.keysetPage({ sort: [["views", "desc"]], limit: 20, after: afterFromUrl, lean: true });
  } catch (error) {
    if (error instanceof KeysetTokenError) throw new __BadRequest__("the page token is invalid");
    throw error;
  }
};
