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
// @errors: 2322
// wrong: the score sorts only in descending order
Articles.find({ $text: { $search: "typed" } }).textScore().sort({ score: 1 });

// right: best first
Articles.find({ $text: { $search: "typed" } }).textScore().sort({ score: -1 });
