import { Entity, Prop, Schema, TypemoClient, PolicyContext, Tenant, type TenantField } from "@venloc/typemo";
@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
  @Prop(() => Number, { required: true }) total!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Orders = client.connection.model(Order);
// ---cut---
const removed = await PolicyContext.run({ tenant: "acme" }, () => Orders.deleteMany({ total: { $gt: 60 } }));
console.log(removed.deletedCount);
// → 1  (only order A-1 of organization acme)

await PolicyContext.run({ tenant: "acme" }, () =>
  Orders.updateOne({ number: "A-2" }, { $set: { tenantId: "globex" } }),
);
// → StrictModeError: Order.updateOne: $set of the tenant field ("tenantId") would move the document to another tenant or lose it [tenant]
