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
    toUpper: fn.toUpper(f.sku),
    toLower: fn.toLower(f.sku),
    strLenCP: fn.strLenCP(f.sku),
    strLenBytes: fn.strLenBytes(f.sku),
    concat: fn.concat(f.sku, "/", f.title),
    split: fn.split(f.sku, "-"),
    strcasecmp: fn.strcasecmp(f.sku, "pen-001"),
    _id: 0,
  })),
);
console.log(row);
// → {toUpper: "PEN-001", toLower: "pen-001", strLenCP: 7, strLenBytes: 7, concat: "PEN-001/  Blue Pen  ", split: ["PEN", "001"], strcasecmp: 0}
