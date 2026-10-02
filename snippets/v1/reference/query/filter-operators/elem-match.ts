import { Entity, Index, Prop, Schema, TypemoClient, fn } from "@venloc/typemo";
@Schema()
class GeoPoint {
  @Prop(() => String, { required: true, enum: ["Point"] }) type!: "Point";
  @Prop(() => [Number], { required: true }) coordinates!: number[];
}
@Schema()
class Variant {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) qty!: number;
}
@Index({ place: "2dsphere" })
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true }) price!: number;
  @Prop(() => Number, { required: true }) stock!: number;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => Date) released?: Date;
  @Prop(() => String, { nullable: true }) note!: string | null;
  @Prop(() => [Variant]) variants!: Variant[];
  @Prop(() => Number) flags?: number;
  @Prop(() => GeoPoint) place?: GeoPoint;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Products = client.db().model(Product);
// ---cut---
const wrong = await Products.find({ "variants.sku": "K-1", "variants.qty": 0 }).plain();
console.log(wrong.map((product) => product.name));
// → ["Keyboard"]  (K-1 and qty 0 are two different elements)

const right = await Products.find({ variants: { $elemMatch: { sku: "K-1", qty: 0 } } }).plain();
console.log(right.map((product) => product.name));
// → []

const second = await Products.find({ variants: { $elemMatch: { sku: "K-2", qty: 0 } } }).plain();
console.log(second.map((product) => product.name));
// → ["Keyboard"]
