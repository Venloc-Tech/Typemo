import { Entity, Prop, Schema, Spec, TypemoClient, fn, Pipeline, type Vector } from "@venloc/typemo";

@Schema({ collection: "articles" })
class Article extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) body!: string;
  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 })) embedding?: Vector;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Articles = client.connection.model(Article);
// ---cut---
export const similar = (queryVector: number[]) =>
  Articles.aggregate((p) =>
    p
      .vectorSearch({ index: "vec", path: "embedding", queryVector, limit: 5, numCandidates: 50 })
      .project(() => ({ title: 1, score: fn.meta("vectorSearchScore"), _id: 0 })),
  ).plain();
