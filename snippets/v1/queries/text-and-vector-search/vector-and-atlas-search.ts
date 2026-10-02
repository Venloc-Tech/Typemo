import { Entity, Prop, Schema, SearchIndex, Spec, type Vector } from "@venloc/typemo";

@SearchIndex({
  name: "embedding_index",
  type: "vectorSearch",
  definition: {
    fields: [{ type: "vector", path: "embedding", numDimensions: 3, similarity: "cosine" }],
  },
})
@Schema({ collection: "documents" })
export class Document extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 }))
  embedding?: Vector;
}
