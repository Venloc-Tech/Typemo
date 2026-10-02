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
    substrCP: fn.substrCP(f.sku, 0, 3),
    substrBytes: fn.substrBytes(f.sku, 4, 3),
    substr: fn.substr(f.sku, 0, 3),
    indexOfCP: fn.indexOfCP(f.sku, "0"),
    indexOfBytes: fn.indexOfBytes(f.sku, "-"),
    _id: 0,
  })),
);
console.log(row);
// → {substrCP: "PEN", substrBytes: "001", substr: "PEN", indexOfCP: 4, indexOfBytes: 3}
