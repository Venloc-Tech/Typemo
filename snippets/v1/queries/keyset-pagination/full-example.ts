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
// your code: __BadRequest__ is your application's error at the boundary

// one feed page: most viewed on top
export const feed = async (afterFromUrl: string | null) => {
  try {
    const page = await Posts.keysetPage({
      filter: { views: { $gt: 0 } },
      sort: [["views", "desc"]],
      limit: 20,
      after: afterFromUrl,
    });
    return {
      items: page.items.map((post) => post.$toPlain()),
      next: page.nextCursor, // null on the last page
    };
  } catch (error) {
    // a token from the client: broken, forged or from another sort
    if (error instanceof KeysetTokenError) throw new __BadRequest__("the page token is invalid");
    throw error;
  }
};
