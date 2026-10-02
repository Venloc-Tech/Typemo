import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Student extends Entity {
  @Prop(() => Spec.map(Number))
  scores?: Map<string, number>;
}
const Students = client.db().model(Student);
try {
  await Students.create({ scores: { "a.b": 1 } });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Map key failed at path "scores.a.b" for "a.b" (string): a key cannot contain "." (it would be read as a path) [key]
try {
  await Students.create({ scores: { $x: 1 } });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Map key failed at path "scores.$x" for "$x" (string): a key cannot start with "$" (reserved for operators) [key]
