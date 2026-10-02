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
import { CastError, StrictModeError } from "@venloc/typemo";

// your code: the error at the application boundary
class __BadRequest__ extends Error {}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// search by optional query parameters
export const searchProducts = async (params: { text?: string; minPrice?: number; tag?: string }) => {
  let query = Products.find().sort({ name: 1 });
  if (params.tag !== undefined) query = query.where({ tags: params.tag });
  if (params.minPrice !== undefined) query = query.where({ price: { $gte: params.minPrice } });
  if (params.text !== undefined) {
    query = query.where({ name: { $regex: escapeRegExp(params.text), $options: "i" } });
  }
  try {
    return await query.plain();
  } catch (error) {
    // filter errors are client input errors, not a server failure
    if (error instanceof CastError || error instanceof StrictModeError) {
      throw new __BadRequest__("the search parameters are invalid");
    }
    throw error;
  }
};

// a variant of this product has the needed stock
export const withVariant = (sku: string, qty: number) =>
  Products.find({ variants: { $elemMatch: { sku, qty } } }).plain();

// products without a release date
export const unreleased = () => Products.find({ released: { $exists: false } }).plain();
