import { Entity, PolicyContext, Prop, Schema, SoftDelete, StrictModeError, Tenant, type TenantField, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "orders", tenant: true, softDelete: true, audit: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
  @Prop(() => Number, { required: true, min: 0 }) total!: number;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}
class __Unauthorized__ extends Error {}
declare const __verifyToken__: (token: string) => { readonly orgId: string; readonly userId: string } | null;
const client = await TypemoClient.connect("mongodb://localhost:27017/crm");
const Orders = client.db().model(Order);
const handle = async <R>(token: string, work: () => Promise<R>): Promise<R> => work();
// ---cut---
export const auditTrail = async () => {
  const entries = await client.unsafeDriver().db("crm").collection("orders_audit").find().toArray();
  return entries.map((entry) => [entry.operation, entry.tenant, entry.actor, entry.softDelete ?? false]);
};
// → [["insertOne", "acme", "user-1", false], ["insertOne", "globex", "user-9", false],
//    ["deleteOne", "acme", "user-1", true], ["updateMany", "acme", "user-1", false]]
