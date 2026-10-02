import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Index({ title: "text", body: "text" })
@Index({ views: 1 })
@Schema({ collection: "articles" })
class Article extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) body!: string;
  @Prop(() => Number, { required: true }) views!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Articles = client.db().model(Article);
// ---cut---
export const search = async (words: string) => {
  const articles = await Articles.find({ $text: { $search: words } }).sort({ title: 1 }).plain();
  return articles.map((article) => article.title);
};

console.log(await search("typed pasta"));
// → ["Cooking", "Mongo tips", "Typed queries"]
console.log(await search("query"));
// → ["Mongo tips", "Typed queries"]
