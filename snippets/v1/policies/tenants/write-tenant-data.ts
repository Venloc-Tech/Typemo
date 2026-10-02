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
export const placeOrder = (tenant: string, number: string, total: number) =>
  PolicyContext.run({ tenant }, () => Orders.create({ number, total }));

const order = await placeOrder("acme", "A-1", 100);
console.log(order.tenantId, order.number);
// → "acme" "A-1"
