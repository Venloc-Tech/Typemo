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
import { expect, test } from "bun:test";
const listOrders = (token: string) => handle(token, async () => Orders.find().plain());
// ---cut---
test("an organization never sees another one's orders", async () => {
  await PolicyContext.run({ tenant: "acme" }, () => Orders.create({ number: "A-1", total: 10 }));
  const foreign = await PolicyContext.run({ tenant: "globex" }, () => Orders.create({ number: "B-1", total: 5 }));

  const seen = await PolicyContext.run({ tenant: "acme" }, () => Orders.find().plain());
  expect(seen.map((order) => order.number)).toEqual(["A-1"]);

  const byId = await PolicyContext.run({ tenant: "acme" }, () => Orders.findById(foreign._id).plain());
  expect(byId).toBeNull();

  const changed = await PolicyContext.run({ tenant: "acme" }, () => Orders.updateOne({ _id: foreign._id }, { $set: { total: 0 } }));
  expect(changed.matchedCount).toBe(0);

  await expect(Orders.find()).rejects.toBeInstanceOf(StrictModeError);
});
