import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
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
export const listPopular = () =>
  Articles.find({ views: { $gt: 10 } }).comment("articles: popular list").sort({ views: -1 }).plain();

console.log((await listPopular()).length);
// → 2
