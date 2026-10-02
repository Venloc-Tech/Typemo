import { Entity, Index, Prop, Schema, SearchIndex, Spec, type Vector } from "@venloc/typemo";

@Index({ title: "text", body: "text" })
@SearchIndex({
  name: "embedding_index",
  type: "vectorSearch",
  definition: {
    fields: [{ type: "vector", path: "embedding", numDimensions: 3, similarity: "cosine" }],
  },
})
@Schema({ collection: "articles" })
export class Article extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  body!: string;

  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 }))
  embedding?: Vector;
}
