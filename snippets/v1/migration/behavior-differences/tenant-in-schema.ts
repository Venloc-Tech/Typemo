import { Entity, PolicyContext, Prop, Schema, Tenant, type TenantField, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "crm" });
const Orders = client.db().model(Order);
// ---cut---
const order = await PolicyContext.run({ tenant: "acme" }, () => Orders.create({ number: "A-1" }));
console.log(order.tenantId);
// → acme

await Orders.find().catch((error) => console.log((error as Error).message));
// → Order.find: Order is scoped by tenant ("tenantId") and the operation has no tenant; run it inside PolicyContext.run({ tenant }, …) or add .policy({ tenant }) to the query (cross-tenant work: .policy({ allTenants: true })) [tenant]
