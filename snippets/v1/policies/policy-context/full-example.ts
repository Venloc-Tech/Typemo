import { Entity, Prop, Schema, TypemoClient, PolicyContext, Tenant, type TenantField } from "@venloc/typemo";
@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Orders = client.connection.model(Order);
// ---cut---
declare const __readToken__: (token: string) => { readonly orgId: string; readonly userId: string };

export const handle = (token: string) => {
  const { orgId, userId } = __readToken__(token);
  return PolicyContext.run({ tenant: orgId, actor: userId }, () => Orders.find().plain());
};

// queue job: values are passed explicitly
export const enqueue = () => PolicyContext.current();
