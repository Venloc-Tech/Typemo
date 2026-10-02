import { ObjectId } from "mongodb";
import { Entity, fn, Pipeline, Prop, type Ref, Schema, TypemoClient, Vars, withWindow } from "@venloc/typemo";
@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => ObjectId, { ref: () => Customer }) referrer?: Ref<Customer>;
}
@Schema()
class Item {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) qty!: number;
  @Prop(() => Number, { required: true }) price!: number;
}
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => ObjectId, { ref: () => Customer, required: true }) customer!: Ref<Customer>;
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
  @Prop(() => [Item]) items!: Item[];
  @Prop(() => String) note?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Customers = client.db().model(Customer);
const Orders = client.db().model(Order);
// ---cut---
const rows = await Orders.aggregate((p) =>
  p
    .sort({ placedAt: 1 })
    .fill({ sortBy: { placedAt: 1 }, output: { note: { value: () => "none" } } })
    .project({ total: 1, note: 1, _id: 0 }),
);
console.log(rows);
// → [{ total: 120, note: "none" }, { total: 40, note: "none" }, { total: 60, note: "gift" }, { total: 30, note: "none" }]
