import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
import { explainIndexUsage } from "@venloc/typemo/testing";
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
const sameIndex = await explainIndexUsage(Articles.find({ views: { $gt: 10 } }).sort({ views: 1 }));
const otherField = await explainIndexUsage(Articles.find({ views: { $gt: 10 } }).sort({ title: 1 }));
console.log(sameIndex.stages, otherField.stages);
// → ["FETCH", "IXSCAN"] ["SORT", "FETCH", "IXSCAN"]
