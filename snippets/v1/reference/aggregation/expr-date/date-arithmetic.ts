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
    dateAdd: fn.dateAdd({ startDate: f.placedAt, unit: "day", amount: 7 }),
    dateSubtract: fn.dateSubtract({ startDate: f.placedAt, unit: "month", amount: 1 }),
    dateDiff: fn.dateDiff({ startDate: f.placedAt, endDate: f.shippedAt, unit: "day" }),
    dateTrunc: fn.dateTrunc({ date: f.placedAt, unit: "month" }),
    _id: 0,
  })),
);
console.log(row);
// → {dateAdd: new Date("2026-03-22T10:30:45.123Z"), dateSubtract: new Date("2026-02-15T10:30:45.123Z"), dateDiff: 3n, dateTrunc: new Date("2026-03-01T00:00:00.000Z")}
