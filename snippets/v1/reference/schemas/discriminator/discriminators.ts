import { Discriminator, Entity, Prop, Schema, TypemoClient, type Discriminators, type DiscriminatorValue } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "shapes", discriminators: () => [Circle, Square] }) // [!code highlight]
class Shape extends Entity {
  declare readonly __t?: Discriminators<Circle | Square>; // [!code highlight]
  @Prop(() => String, { required: true })
  name!: string;
}

@Discriminator("circle")
class Circle extends Shape {
  declare readonly __t: DiscriminatorValue<"circle">;
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
const shapes = await Shapes.find().sort({ name: 1 }).plain();
const areas = shapes.map((shape) => {
  if (shape.__t === "circle") {
    const radius = shape.radius;
    //    ^?
    return Math.round(Math.PI * radius ** 2);
  }
  if (shape.__t === "square") return shape.side ** 2;
  return 0;
});
console.log(areas);
// → [0, 13, 9]
