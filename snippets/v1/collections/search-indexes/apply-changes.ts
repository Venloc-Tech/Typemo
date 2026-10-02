import { Entity, Prop, Schema, SearchIndex, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "articles" })
@SearchIndex({ name: "articles_text", definition: { mappings: { dynamic: true } } })
class Article extends Entity {
  @Prop(() => String, { required: true }) body!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Articles = client.connection.model(Article);
// ---cut---
const plan = await Articles.syncSearchIndexes({ dryRun: true });
console.log(plan.dryRun, plan.toCreate);
// on a server with Atlas Search: true ["articles_text"]
