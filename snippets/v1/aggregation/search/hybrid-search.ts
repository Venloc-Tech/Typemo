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
const pipeline = Pipeline.from(Article)
  .rankFusion({
    input: {
      pipelines: {
        text: (p) => p.search({ text: { path: "body", query: "mongo" } }).limit(10),
        vector: (p) =>
          p.vectorSearch({ index: "vec", path: "embedding", queryVector: [0.1, 0.2, 0.3], limit: 10 }),
      },
    },
    combination: { weights: { text: 2, vector: 1 } },
  })
  .limit(5);
