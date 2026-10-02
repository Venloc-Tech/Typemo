import { Entity, Prop, Schema, TypemoClient, PolicyContext, Tenant, type TenantField } from "@venloc/typemo";
@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Orders = client.connection.model(Order);
// ---cut---
// wrong: the query is built outside the scope, awaited inside
const query = Orders.find();
await PolicyContext.run({ tenant: "acme" }, async () => query.plain());
// at runtime: StrictModeError … the operation has no tenant … [tenant]

// right: build inside the scope
await PolicyContext.run({ tenant: "acme" }, async () => Orders.find().plain());
