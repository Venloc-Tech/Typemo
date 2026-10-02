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
const both = await Products.find({ price: { $gt: 10 }, stock: { $gt: 0 } }).sort({ name: 1 }).plain();
// → ["Keyboard", "Monitor"]

const either = await Products.find({ $or: [{ price: { $lt: 30 } }, { stock: 3 }] })
  .sort({ name: 1 })
  .plain();
// → ["Monitor", "Mouse"]

const neither = await Products.find({ $nor: [{ price: { $lt: 30 } }, { stock: 3 }] }).plain();
// → ["Keyboard"]
