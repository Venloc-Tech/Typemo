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
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const searchProducts = (params: { text?: string; minPrice?: number; tag?: string }) => {
  let query = Products.find().sort({ name: 1 });
  if (params.tag !== undefined) query = query.where({ tags: params.tag });
  if (params.minPrice !== undefined) query = query.where({ price: { $gte: params.minPrice } });
  if (params.text !== undefined) {
    query = query.where({ name: { $regex: escapeRegExp(params.text), $options: "i" } });
  }
  return query.plain();
};

console.log((await searchProducts({ tag: "usb", minPrice: 30 })).map((product) => product.name));
// → ["Keyboard"]
console.log((await searchProducts({})).length);
// → 3
