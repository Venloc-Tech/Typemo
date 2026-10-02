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
const counts = await client.transaction(async () => {
  await Orders.create({ number: 10, status: "tx" });
  const inside = await Orders.countDocuments({ number: 10 });
  const outside = await Orders.countDocuments({ number: 10 }).session(null);
  return [inside, outside];
});
// → [1, 0]
