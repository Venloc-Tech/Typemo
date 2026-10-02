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
    dateFromParts: fn.dateFromParts({ year: 2026, month: 3, day: 15 }),
    dateToParts: fn.dateToParts({ date: f.placedAt }),
    dateFromString: fn.dateFromString({ dateString: "2026-03-15", onError: null }),
    dateToString: fn.dateToString({ date: f.placedAt, format: "%Y-%m-%d" }),
    _id: 0,
  })),
);
console.log(row);
// → {dateFromParts: new Date("2026-03-15T00:00:00.000Z"), dateToParts: {year: 2026, month: 3, day: 15, hour: 10, minute: 30, second: 45, millisecond: 123}, dateFromString: new Date("2026-03-15T00:00:00.000Z"), dateToString: "2026-03-15"}
