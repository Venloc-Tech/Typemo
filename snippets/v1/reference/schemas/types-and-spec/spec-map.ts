import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Student extends Entity {
  @Prop(() => Spec.map(Number)) // [!code highlight]
  scores?: Map<string, number>;
}
const Students = client.db().model(Student);
const student = await Students.create({ scores: { math: 5 } });
student.scores?.set("art", 4);
console.log([...(student.scores ?? [])]);
// → [["math", 5], ["art", 4]]
