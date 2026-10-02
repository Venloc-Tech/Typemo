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
const query = Products.aggregate((p) =>
  p.project((f) => ({
    title: 1,
    _id: 0,
    label: fn.concat(f.title, " (", fn.toString_(f.price), ")"),
    tier: fn.cond(fn.gte(f.price, 30), "premium", "basic"),
  })),
);
const rows = await query;
//    ^?
// → [{ title: "Kettle", label: "Kettle (40)", tier: "premium" }, { title: "Lamp", … "basic" }, …]
