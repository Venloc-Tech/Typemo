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
const good = await Articles.find({ views: 500 }).explain("executionStats");
console.log(good.executionStats);
// → { nReturned: 1, totalKeysExamined: 1, totalDocsExamined: 1, … }

const bad = await Articles.find({ body: "pasta" }).explain("executionStats");
console.log(bad.executionStats);
// → { nReturned: 1, totalKeysExamined: 0, totalDocsExamined: 3, … }
