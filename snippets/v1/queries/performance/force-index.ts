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
const byName = await Articles.find({ views: { $gt: 10 } }).hint("views_1").sort({ views: 1 }).plain();
const byKeys = await Articles.find({ views: { $gt: 10 } }).hint({ views: 1 }).sort({ views: 1 }).plain();
console.log(byName.length, byKeys.length);
// → 2 2
