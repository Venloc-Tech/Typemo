import { Discriminator, Entity, Prop, Schema, TypemoClient, type DiscriminatorValue } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
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
const circle = await Circles.findOne({ name: "c" }).orFail();
// ---cut---
// @errors: 2540
circle.__t = "square";
