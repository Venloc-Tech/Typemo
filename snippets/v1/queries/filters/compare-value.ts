import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema()
class Variant {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) qty!: number;
}
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true }) price!: number;
  @Prop(() => Number, { required: true }) stock!: number;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => Date) released?: Date;
  @Prop(() => String, { nullable: true }) note!: string | null;
  @Prop(() => [Variant]) variants!: Variant[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Products = client.db().model(Product);
// ---cut---
const names = async (query: { plain(): PromiseLike<{ name: string }[]> }) =>
  (await query.plain()).map((product) => product.name);

console.log(await names(Products.find({ price: { $gte: 20, $lt: 300 } }).sort({ name: 1 })));
// → ["Keyboard", "Mouse"]

console.log(await names(Products.find({ released: { $gte: new Date("2025-03-01") } })));
// → ["Mouse"]
