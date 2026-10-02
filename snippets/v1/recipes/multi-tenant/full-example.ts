import {
  Entity,
  PolicyContext,
  Prop,
  Schema,
  SoftDelete,
  Tenant,
  type TenantField,
  TypemoClient,
} from "@venloc/typemo";

// your code: authentication
export class __Unauthorized__ extends Error {}
declare const __verifyToken__: (token: string) => { readonly orgId: string; readonly userId: string } | null;

// orders/order.ts
@Schema({ collection: "orders", tenant: true, softDelete: true, audit: true })
export class Order extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  number!: string;

  @Prop(() => Number, { required: true, min: 0 })
  total!: number;

  @Prop(() => Date, { nullable: true })
  deletedAt?: Date | null;
}

export const client = await TypemoClient.connect("mongodb://localhost:27017/crm");
const Orders = client.db().model(Order);

// http/handle.ts: one scope per request
export const handle = async <R>(token: string, work: () => Promise<R>): Promise<R> => {
  const identity = __verifyToken__(token);
  if (identity === null || identity.orgId === "") throw new __Unauthorized__("invalid token");
  return PolicyContext.run({ tenant: identity.orgId, actor: identity.userId }, work);
};

// orders/orders.service.ts: no tenant anywhere
export const placeOrder = (token: string, number: string, total: number) =>
  handle(token, async () => (await Orders.create({ number, total })).$toPlain());

export const listOrders = (token: string) =>
  handle(token, async () => Orders.find().sort({ number: 1 }).plain());

export const cancelOrder = (token: string, id: string) =>
  handle(token, async () => {
    await Orders.deleteOne({ _id: id }).orFail();
  });

export const restoreOrder = (token: string, id: string) =>
  handle(token, async () => {
    await SoftDelete.restore(Orders, { _id: id }).orFail();
  });

export const listCancelled = (token: string) =>
  handle(token, async () => Orders.find().policy({ onlyDeleted: true }).plain());

// admin/report.ts: cross-tenant work is explicit
export const countAllOrders = () => Orders.countDocuments().policy({ allTenants: true });

// admin/audit.ts: the audit trail, read past the policies
export const auditTrail = async () => {
  const entries = await client.unsafeDriver().db("crm").collection("orders_audit").find().toArray();
  return entries.map((entry) => [entry.operation, entry.tenant, entry.actor, entry.softDelete ?? false]);
};
