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
const withTax = Pipeline.from(Product).addFields((f) => ({
  gross: fn.multiply(f.price, 1.2),
}));
type Row = RowOf<typeof withTax>;
//   ^?
