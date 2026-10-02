import { Entity, GeoJson, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema()
class GeoPoint {
  @Prop(() => String, { required: true, enum: ["Point"] }) type!: "Point";
  @Prop(() => [Number], { required: true }) coordinates!: number[];
}
@Index({ place: "2dsphere" })
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true }) price!: number;
  @Prop(() => GeoPoint) place?: GeoPoint;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Products = client.db().model(Product);
// ---cut---
const paris = GeoJson.point(2.3, 48.8);
//    ^?

const near = await Products.find({ place: { $near: { $geometry: paris, $maxDistance: 20_000 } } }).plain();
console.log(near.map((product) => product.name));
// → ["Keyboard"]
