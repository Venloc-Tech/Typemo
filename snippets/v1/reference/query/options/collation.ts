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
const exact = await Orders.find({ status: "paid" }).plain();
console.log(exact.map((order) => order.number));
// → [2]

const anyCase = await Orders.find({ status: "paid" })
  .collation({ locale: "en", strength: 2 })
  .sort({ number: 1 })
  .plain();
console.log(anyCase.map((order) => order.number));
// → [1, 2]
