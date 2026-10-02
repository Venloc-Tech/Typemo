import { Entity, Prop, Schema, TypemoClient, fn, Pipeline, Vars, type RowOf } from "@venloc/typemo";

@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) price!: number;
  @Prop(() => Number) discount?: number;
  @Prop(() => [String], { required: true }) tags!: string[];
}

const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Products = client.connection.model(Product);
// ---cut---
const cheap = await Products.aggregate((p) =>
  p.match((f) => fn.lt(fn.subtract(f.price, fn.ifNull(f.discount, 0)), 30)).project({ title: 1, _id: 0 }),
);
// → [{ title: "Lamp" }, { title: "$5 mug" }]
