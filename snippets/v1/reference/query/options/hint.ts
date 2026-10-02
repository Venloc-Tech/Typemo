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
const byName = await Orders.find().hint("number_1").sort({ number: 1 }).plain();
const byPattern = await Orders.find().hint({ number: 1 }).sort({ number: 1 }).plain();
console.log(byName.length, byPattern.length);
// → 2 2
