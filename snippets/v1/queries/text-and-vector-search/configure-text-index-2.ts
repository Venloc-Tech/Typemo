import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Index({ title: "text", body: "text" }, { weights: { title: 10, body: 1 }, name: "article_text" })
@Schema({ collection: "weighted_articles" })
class WeightedArticle extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) body!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Articles = client.db().model(WeightedArticle);
// ---cut---
const found = await Articles.find({ $text: { $search: "typed" } }).textScore().sort({ title: 1 }).plain();
console.log(found.map((article) => [article.title, article.score]));
// → [["other", 1.75], ["typed", 10]]
