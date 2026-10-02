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
    kitchen: fn.filter({ input: f.tags, cond: (tag) => fn.eq(tag, "kitchen") }),
    upper: fn.map({ input: f.tags, in: (tag) => fn.toUpper(tag) }),
  })),
);
const rows = await query;
//    ^?
// → [{ title: "Kettle", kitchen: ["kitchen"], upper: ["KITCHEN", "SALE"] }, …]
