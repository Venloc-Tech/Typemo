import { Entity, Prop, Schema, Spec, TypemoClient, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "embeddings" })
class Embedding extends Entity {
  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 })) // [!code highlight]
  values?: Vector;
}
const Embeddings = client.connection.model(Embedding);
const embedding = await Embeddings.create({ values: [0.5, 0.25, 0.125] });
console.log(embedding.values?.constructor.name, embedding.$toPlain().values);
// → Binary [0.5, 0.25, 0.125]
try {
  await Embeddings.create({ values: [1, 2] });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Vector<float32, 3> failed at path "values" for [array of 2]: expected 3 dimensions, got 2 [dimensions]
