import { Entity, Prop, Schema, SearchIndex, Spec, TypemoClient, type Vector } from "@venloc/typemo";
@SearchIndex({
  name: "embedding_index",
  type: "vectorSearch",
  definition: { fields: [{ type: "vector", path: "embedding", numDimensions: 3, similarity: "cosine" }] },
})
@Schema({ collection: "documents" })
class Document extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 })) embedding?: Vector;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Documents = client.db().model(Document);
// ---cut---
export const similar = (queryVector: number[]) =>
  Documents.aggregate((p) =>
    p.vectorSearch({ index: "embedding_index", path: "embedding", queryVector, limit: 5, numCandidates: 50 }),
  ).plain();
