import { Entity, Prop, Schema, TypemoClient, Tenant, type TenantField } from "@venloc/typemo";
@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Orders = client.connection.model(Order);
// ---cut---
const all = await Orders.find().policy({ allTenants: true }).sort({ number: 1 }).plain();
console.log(all.map((order) => `${order.tenantId}:${order.number}`));
// → ["acme:A-1", "acme:A-2", "globex:G-1"]
