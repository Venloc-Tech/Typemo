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
  .search({ index: "articles_text", text: { path: "title", query: "mongo" } })
  .project(() => ({ title: 1, score: fn.meta("searchScore") }));
console.log(JSON.stringify(pipeline.plan().pipeline));
// → [{"$search":{"index":"articles_text","text":{"path":"title","query":"mongo"}}},{"$project":{"title":1,"score":{"$meta":"searchScore"}}}]
