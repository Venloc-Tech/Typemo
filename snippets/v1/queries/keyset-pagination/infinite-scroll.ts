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
const pageAfter = (after: string | null) =>
  Posts.keysetPage({ sort: [["views", "desc"]], limit: 3, after });

export const allTitles = async () => {
  let page = await pageAfter(null);
  const titles = page.items.map((post) => post.title);
  while (page.nextCursor !== null) {
    page = await pageAfter(page.nextCursor);
    titles.push(...page.items.map((post) => post.title));
  }
  return titles;
};

console.log(await allTitles());
// → ["A", "C", "B", "D", "E", "G", "F"]
