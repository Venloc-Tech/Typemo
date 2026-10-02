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
const pipeline = Pipeline.from(Article).search({
  index: "articles_text",
  compound: {
    must: [{ text: { path: "title", query: "mongo" } }],
    should: [{ phrase: { path: "body", query: "full text" } }],
  },
});
