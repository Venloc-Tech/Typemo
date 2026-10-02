import { Entity, Prop, Schema, TypemoClient, PolicyContext, Tenant, type TenantField } from "@venloc/typemo";
@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Orders = client.connection.model(Order);
// ---cut---
// built inside the scope, awaited outside: tenant acme is kept
const pending = PolicyContext.run({ tenant: "acme" }, () => Orders.find().plain());
const rows = await pending;
