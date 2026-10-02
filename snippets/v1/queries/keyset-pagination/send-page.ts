import { Entity, KeysetTokenError, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
  @Prop(() => Boolean) draft?: boolean;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Posts = client.db().model(Post);
declare class __BadRequest__ extends Error {}
// ---cut---
export const listPosts = async (afterFromUrl: string | null) => {
  try {
    const page = await Posts.keysetPage({ sort: [["views", "desc"]], limit: 20, after: afterFromUrl });
    return { items: page.items.map((post) => post.$toPlain()), next: page.nextCursor };
  } catch (error) {
    if (error instanceof KeysetTokenError) throw new __BadRequest__("the page token is invalid");
    throw error;
  }
};
