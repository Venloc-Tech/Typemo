import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Doc extends Versioned(Entity) { // [!code highlight]
  @Prop(() => [String])
  tags!: string[];
  @Prop(() => String)
  title?: string;
}
const Docs = client.db().model(Doc);
const doc = await Docs.create({ tags: ["a"] });
console.log(doc.__v);
// → 0
doc.tags.push("b");
await doc.$save();
console.log(doc.__v);
// → 1
doc.title = "x";
await doc.$save();
console.log(doc.__v);
// → 1
