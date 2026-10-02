import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Index({ title: "text", body: "text" })
@Schema({ collection: "articles" })
class Article extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) body!: string;
  @Prop(() => Number, { required: true }) views!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Articles = client.db().model(Article);
// ---cut---
// wrong: a score without text search
await Articles.find({ views: { $gt: 10 } }).textScore().plain();

// right: the score together with $text
await Articles.find({ $text: { $search: "typed" } }).textScore().plain();
