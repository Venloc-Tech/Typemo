import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "shapes" })
class Shape extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Discriminator("circle")
class Circle extends Shape {
  declare readonly __t: DiscriminatorValue<"circle">;
  @Prop(() => Number, { required: true }) radius!: number;
}
const Circles = client.db().model(Circle);
try {
  await Circles.create({ name: "c", side: 2 } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Circle failed at path "side" for 2 (number): not a field of Circle [unknown-key]
