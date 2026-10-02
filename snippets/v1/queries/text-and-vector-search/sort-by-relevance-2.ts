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
const best = await Articles.find({ $text: { $search: "typed queries" } }).textScore("score", { sort: true }).plain();
console.log(best.map((article) => [article.title, article.score]));
// → [["Typed queries", 2.25], ["Mongo tips", 2.15625]]
