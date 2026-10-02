import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Embedding extends Entity {
  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 })) // [!code highlight]
  values?: Vector;
}
const Embeddings = client.db().model(Embedding);
const embedding = await Embeddings.create({ values: [1, 2, 3] }); // [!code highlight]
console.log(embedding.$toPlain().values);
// → [1, 2, 3]
try {
  await Embeddings.create({ values: [1, 2] });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Vector<float32, 3> failed at path "values" for [array of 2]: expected 3 dimensions, got 2 [dimensions]
