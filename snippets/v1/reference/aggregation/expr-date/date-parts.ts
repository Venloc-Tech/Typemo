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
    year: fn.year(f.placedAt),
    month: fn.month(f.placedAt),
    dayOfMonth: fn.dayOfMonth(f.placedAt),
    hour: fn.hour(f.placedAt),
    minute: fn.minute(f.placedAt),
    second: fn.second(f.placedAt),
    millisecond: fn.millisecond(f.placedAt),
    dayOfWeek: fn.dayOfWeek(f.placedAt),
    dayOfYear: fn.dayOfYear(f.placedAt),
    week: fn.week(f.placedAt),
    isoWeek: fn.isoWeek(f.placedAt),
    isoWeekYear: fn.isoWeekYear(f.placedAt),
    isoDayOfWeek: fn.isoDayOfWeek(f.placedAt),
    _id: 0,
  })),
);
console.log(row);
// → {year: 2026, month: 3, dayOfMonth: 15, hour: 10, minute: 30, second: 45, millisecond: 123, dayOfWeek: 1, dayOfYear: 74, week: 11, isoWeek: 11, isoWeekYear: 2026n, isoDayOfWeek: 7}
