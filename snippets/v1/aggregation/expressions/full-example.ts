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
export const priceList = () =>
  Products.aggregate((p) =>
    p
      .addFields((f) => ({
        final: fn.subtract(f.price, fn.ifNull(f.discount, 0)),
      }))
      .match((f) => fn.gt(f.final, 10))
      .project((f) => ({
        _id: 0,
        title: 1,
        final: 1,
        tier: fn.cond(fn.gte(f.final, 30), "premium", "basic"),
        tags: fn.map({ input: f.tags, in: (tag) => fn.toUpper(tag) }),
      }))
      .sort({ final: "descending" }),
  ).plain();
