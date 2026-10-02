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
const Shapes = client.db().model(Shape);
const Circles = client.db().model(Circle);
await Shapes.create({ name: "base" });
const all = await Shapes.find().sort({ name: 1 }).plain();
console.log(all.map((shape) => shape.name));
// → ["base", "c", "s"]
const circles = await Circles.find().plain();
console.log(circles.map((circle) => circle.name));
// → ["c"]
const loaded = await Shapes.find({ name: "c" });
console.log(loaded[0]?.constructor.name);
// → Circle
