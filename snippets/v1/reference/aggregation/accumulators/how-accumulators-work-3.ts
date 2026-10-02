// @errors: 2769
import { Entity, Prop, Schema, TypemoClient, fn } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => String, { required: true, enum: ["new", "paid", "cancelled"] }) status!: "new" | "paid" | "cancelled";
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Number) discount?: number;
  @Prop(() => [Number]) prices!: number[];
  @Prop(() => Date, { required: true }) placedAt!: Date;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
await Orders.aggregate((p) => p.project((f) => ({ _id: 0, all: fn.push(f.total) })));
