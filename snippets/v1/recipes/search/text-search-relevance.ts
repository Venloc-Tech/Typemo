import { Entity, Index, Prop, Schema, SearchIndex, ServerError, Spec, TypemoClient, type Vector } from "@venloc/typemo";
class __BadRequest__ extends Error {}
declare const __embed__: (text: string) => Promise<number[]>;
@Index({ title: "text", body: "text" })
@SearchIndex({
  name: "embedding_index",
  type: "vectorSearch",
  definition: { fields: [{ type: "vector", path: "embedding", numDimensions: 3, similarity: "cosine" }] },
})
@Schema({ collection: "articles" })
class Article extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) body!: string;
  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 })) embedding?: Vector;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/help");
const Articles = client.db().model(Article);
const cleanQuery = (text: string): string => text.trim();
// ---cut---
export const searchByWords = (text: string, limit: number) =>
  Articles.find({ $text: { $search: cleanQuery(text) } })
    .textScore("score", { sort: true })
    .limit(limit)
    .select({ title: 1 })
    .plain();
