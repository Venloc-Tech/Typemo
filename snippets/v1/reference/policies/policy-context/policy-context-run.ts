import { Entity, Prop, Schema, TypemoClient, PolicyContext, Tenant, type TenantField } from "@venloc/typemo";
@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Orders = client.connection.model(Order);
// ---cut---
await PolicyContext.run({ tenant: "acme" }, async () => {
  await Orders.create({ number: "A-1" });
});

const acme = await PolicyContext.run({ tenant: "acme" }, () => Orders.find().plain());
console.log(acme.map((order) => order.number));
// → ["A-1"]
