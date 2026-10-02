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
const query = Articles.find({ $text: { $search: "typed queries" } }).textScore().sort({ title: 1 }).plain();
const found = await query;
//    ^?
console.log(found.map((article) => [article.title, article.score]));
// → [["Mongo tips", 2.15625], ["Typed queries", 2.25]]
