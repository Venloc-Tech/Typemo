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
const usb = await Products.find({ tags: "usb" }).sort({ name: 1 }).plain();
// → ["Keyboard", "Mouse"]

const both = await Products.find({ tags: { $all: ["usb", "office"] } }).plain();
// → ["Keyboard"]

const untagged = await Products.find({ tags: { $size: 0 } }).plain();
// → ["Monitor"]
