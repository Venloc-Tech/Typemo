import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Index({ number: 1 })
@Schema({ collection: "orders", softDelete: true })
class Order extends Entity {
  @Prop(() => Number, { required: true }) number!: number;
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Orders = client.db().model(Order);
// ---cut---
const live = await Orders.find().sort({ number: 1 }).plain();
console.log(live.map((order) => order.number));
// → [1, 2]

const all = await Orders.find().policy({ includeDeleted: true }).sort({ number: 1 }).plain();
console.log(all.map((order) => order.number));
// → [1, 2, 3]

const deleted = await Orders.find().policy({ onlyDeleted: true }).plain();
console.log(deleted.map((order) => order.number));
// → [3]
