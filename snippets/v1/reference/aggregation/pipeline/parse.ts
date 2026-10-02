import { Entity, type Hidden, fn, Index, Pipeline, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "orders" })
@Index({ status: 1 })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => BigInt) points?: bigint;
  @Prop(() => String, { hidden: true }) internalNote?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
import type { StandardSchemaV1 } from "@venloc/typemo";
// ---cut---
const rowSchema: StandardSchemaV1<unknown, { status: string; orders: number }> = {
  "~standard": {
    version: 1,
    vendor: "example",
    validate: (row) => {
      const value = row as { _id: string; orders: number };
      return typeof value.orders === "number"
        ? { value: { status: value._id, orders: value.orders } }
        : { issues: [{ message: "orders must be a number", path: ["orders"] }] };
    },
  },
};
const rows = await Orders.aggregate((p) =>
  p.group((f) => ({ _id: f.status, orders: fn.count() })).sort({ _id: 1 }),
).parse(rowSchema);
console.log(rows);
// → [{ status: "open", orders: 1 }, { status: "paid", orders: 2 }]
