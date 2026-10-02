import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
// model: prices per currency in a map
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Spec.map(Number)) prices?: Map<string, number>;
}

// your code: the error at the application boundary
class __BadRequest__ extends Error {}

// create a product: keys are checked on write
export const addProduct = async (title: string, prices: Record<string, number>) => {
  const Products = client.connection.model(Product);
  try {
    return await Products.create({ title, prices });
  } catch (error) {
    throw new __BadRequest__((error as Error).message);
  }
};

// change one price: a path by key, the rest untouched
export const setEuroPrice = async (title: string, price: number) => {
  const Products = client.connection.model(Product);
  await Products.updateOne({ title }, { $set: { "prices.EUR": price } });
};

await addProduct("Lamp", { USD: 10 });
await setEuroPrice("Lamp", 9);
const lamp = await client.connection.model(Product).findOne({ title: "Lamp" }).orFail();
console.log(lamp.$toJSON().prices);
// → { USD: 10, EUR: 9 }
