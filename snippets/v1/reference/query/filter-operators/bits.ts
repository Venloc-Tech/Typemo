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
const bits02 = await Products.find({ flags: { $bitsAllSet: [0, 2] } }).sort({ name: 1 }).plain();
console.log(bits02.map((product) => product.name));
// → ["Keyboard", "Monitor"]

const anyOf1 = await Products.find({ flags: { $bitsAnySet: 2 } }).sort({ name: 1 }).plain();
console.log(anyOf1.map((product) => product.name));
// → ["Monitor", "Mouse"]

const bit0Clear = await Products.find({ flags: { $bitsAllClear: [0] } }).plain();
console.log(bit0Clear.map((product) => product.name));
// → ["Mouse"]

const someClear = await Products.find({ flags: { $bitsAnyClear: [0, 1] } }).sort({ name: 1 }).plain();
console.log(someClear.map((product) => product.name));
// → ["Keyboard", "Mouse"]
