import { Entity, Prop, Schema, SearchIndex, ServerError, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "articles" })
@SearchIndex({ name: "articles_text", definition: { mappings: { dynamic: true } } })
class Article extends Entity {
  @Prop(() => String, { required: true }) body!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Articles = client.connection.model(Article);
// ---cut---
try {
  await Articles.diffSearchIndexes();
} catch (error) {
  if (error instanceof ServerError) console.log(error.code);
  // → 31082
}
