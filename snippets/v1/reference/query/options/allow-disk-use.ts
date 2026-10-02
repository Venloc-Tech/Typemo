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
const orders = await Orders.find().sort({ status: 1, number: 1 }).allowDiskUse(true).plain();
console.log(orders.length);
// → 2
