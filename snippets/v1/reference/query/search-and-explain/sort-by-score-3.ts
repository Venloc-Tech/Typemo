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
const rows = await Articles.find({ $text: { $search: "typed queries" } }).textScore().select({ title: 1, score: 1 }).sort({ score: -1 }).plain();
//    ^?
