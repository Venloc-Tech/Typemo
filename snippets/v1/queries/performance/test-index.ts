import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
import { expectIndexScan } from "@venloc/typemo/testing";
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
const usage = await expectIndexScan(Articles.find({ views: 500 }), { index: "views_1", maxDocsExamined: 1 });
console.log(usage.stages);
// → ["FETCH", "IXSCAN"]

try {
  await expectIndexScan(Articles.find({ body: "pasta" }));
} catch (error) {
  console.log(String(error));
  // → "IndexUsageError: the query is not served by an index: it scans the whole collection (COLLSCAN). plan: COLLSCAN; examined 3 documents, returned 1"
}
