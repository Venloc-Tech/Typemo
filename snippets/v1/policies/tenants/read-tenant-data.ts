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
export const listOrders = (tenant: string) =>
  PolicyContext.run({ tenant }, () => Orders.find().sort({ number: 1 }).plain());

const acme = await listOrders("acme");
console.log(acme.map((order) => order.number));
// → ["A-1", "A-2"]
const globex = await PolicyContext.run({ tenant: "globex" }, () => Orders.countDocuments());
// → 1
