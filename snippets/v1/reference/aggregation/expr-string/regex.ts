import { Timestamp } from "mongodb";
import { Entity, fn, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema()
class Line {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) qty!: number;
}
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) price!: number;
  @Prop(() => Number, { required: true }) quantity!: number;
  @Prop(() => Number, { required: true }) delta!: number;
  @Prop(() => Number, { required: true }) ratio!: number;
  @Prop(() => Number) discount?: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
  @Prop(() => Date, { required: true }) shippedAt!: Date;
  @Prop(() => Timestamp) stamp?: Timestamp;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Number]) prices!: number[];
  @Prop(() => [Line]) lines!: Line[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
const [row] = await Orders.aggregate((p) =>
  p.project((f) => ({
    regexMatch: fn.regexMatch({ input: f.sku, regex: /^pen/, options: "i" }),
    regexFind: fn.regexFind({ input: f.sku, regex: /[0-9]+/ }),
    regexFindAll: fn.regexFindAll({ input: f.sku, regex: "[A-Z]" }),
    _id: 0,
  })),
);
console.log(row);
// → {regexMatch: true, regexFind: {match: "001", idx: 4, captures: []}, regexFindAll: [{match: "P", idx: 0, captures: []}, {match: "E", idx: 1, captures: []}, {match: "N", idx: 2, captures: []}]}
