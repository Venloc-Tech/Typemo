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
const covered = await explainIndexUsage(Articles.find({ views: { $gt: 10 } }).select({ views: 1, _id: 0 }));
console.log(covered.stages, covered.docsExamined, covered.covered);
// → ["PROJECTION_COVERED", "IXSCAN"] 0 true

const fetched = await explainIndexUsage(Articles.find({ views: { $gt: 10 } }));
console.log(fetched.stages, fetched.docsExamined, fetched.covered);
// → ["FETCH", "IXSCAN"] 2 false
