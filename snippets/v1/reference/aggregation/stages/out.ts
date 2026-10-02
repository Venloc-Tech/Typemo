import { ObjectId } from "mongodb";
import { Entity, EntityWithId, fn, Pipeline, Prop, type Ref, Schema, TypemoClient, Vars, withWindow } from "@venloc/typemo";
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
@Schema({ collection: "status_totals" })
class StatusTotal extends EntityWithId(() => String) { // [!code highlight]
  @Prop(() => Number, { required: true }) revenue!: number;
  @Prop(() => Number, { required: true }) orders!: number;
}

await Orders.aggregate((p) =>
  p.group((f) => ({ _id: f.status, revenue: fn.sum(f.total), orders: fn.count() })).out(StatusTotal),
);
const StatusTotals = client.db().model(StatusTotal);
console.log(await StatusTotals.find().sort({ _id: 1 }).lean());
// → [{ _id: "open", revenue: 40, orders: 1 }, { _id: "paid", revenue: 210, orders: 3 }]
