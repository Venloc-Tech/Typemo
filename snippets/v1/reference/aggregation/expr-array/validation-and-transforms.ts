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
    allElementsTrue: fn.allElementsTrue(f.prices),
    anyElementTrue: fn.anyElementTrue(f.prices),
    map: fn.map({ input: f.prices, in: (price) => fn.multiply(price, 2) }),
    filter: fn.filter({ input: f.prices, cond: (price) => fn.gt(price, 15) }),
    reduce: fn.reduce({ input: f.prices, initialValue: 0, in: (acc, price) => fn.add(acc, price) }),
    arrayToObject: fn.arrayToObject(fn.map({ input: f.lines, in: (line) => ({ k: line.sku, v: line.qty }) })),
    _id: 0,
  })),
);
console.log(row);
// → {allElementsTrue: true, anyElementTrue: true, map: [60, 20, 40], filter: [30, 20], reduce: 60, arrayToObject: {pen: 2, ink: 1}}
