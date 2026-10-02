import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "shapes" })
class Shape extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}

@Discriminator("circle") // [!code highlight]
class Circle extends Shape {
  declare readonly __t: DiscriminatorValue<"circle">; // [!code highlight]
  @Prop(() => Number, { required: true })
  radius!: number;
}

@Discriminator("square")
class Square extends Shape {
  declare readonly __t: DiscriminatorValue<"square">;
  @Prop(() => Number, { required: true })
  side!: number;
}
const Shapes = client.db().model(Shape);
const Circles = client.db().model(Circle);
const Squares = client.db().model(Square);
const circle = await Circles.create({ name: "c", radius: 2 });
const square = await Squares.create({ name: "s", side: 3 });
console.log(circle.__t, square.__t);
// → circle square
