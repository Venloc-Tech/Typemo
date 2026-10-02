import { Entity, Prop, Schema, Tenant, TypemoClient, type TenantField } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ tenant: true }) // [!code highlight]
class Doc extends Entity {
  @Prop(() => String) @Tenant() // [!code highlight]
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  title!: string;
}
const Docs = client.db().model(Doc);
const doc = await Docs.create({ title: "Plan" }, { policy: { tenant: "acme" } });
console.log(doc.tenantId);
// → acme
