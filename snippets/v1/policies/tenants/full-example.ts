import { Entity, Prop, Schema, TypemoClient, PolicyContext, Tenant, type TenantField } from "@venloc/typemo";

@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
  @Prop(() => Number, { required: true }) total!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Orders = client.connection.model(Order);

// your code: the organization from the token
declare const __orgOf__: (token: string) => string;

// write: the model sets the tenant
export const placeOrder = (token: string, number: string, total: number) =>
  PolicyContext.run({ tenant: __orgOf__(token) }, () => Orders.create({ number, total }));

// read: only the orders of your organization
export const listOrders = (token: string) =>
  PolicyContext.run({ tenant: __orgOf__(token) }, () => Orders.find().sort({ number: 1 }).plain());

// a report over every organization: explicit
export const countAllOrders = () => Orders.countDocuments().policy({ allTenants: true });
