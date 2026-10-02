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
    size: fn.size(f.tags),
    arrayElemAt: fn.arrayElemAt(f.tags, 0),
    indexOfArray: fn.indexOfArray(f.tags, "sale"),
    slice: fn.slice(f.tags, 1, 1),
    reverseArray: fn.reverseArray(f.tags),
    sortArray: fn.sortArray({ input: f.prices, sortBy: 1 }),
    range: fn.range(0, 5, 2),
    _id: 0,
  })),
);
console.log(row);
// → {size: 3, arrayElemAt: "new", indexOfArray: 1, slice: ["sale"], reverseArray: ["pen", "sale", "new"], sortArray: [10, 20, 30], range: [0, 2, 4]}
