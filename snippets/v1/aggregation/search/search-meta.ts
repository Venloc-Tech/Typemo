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
const pipeline = Pipeline.from(Article).searchMeta({
  index: "articles_text",
  text: { path: "title", query: "mongo" },
  count: { type: "total" },
});
console.log(JSON.stringify(pipeline.plan().pipeline));
// → [{"$searchMeta":{"index":"articles_text","text":{"path":"title","query":"mongo"},"count":{"type":"total"}}}]
