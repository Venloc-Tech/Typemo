import { Entity, Prop, Schema, Tenant, TypemoClient, type TenantField } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ tenant: true })
class Note extends Entity {
  @Prop(() => String) @Tenant() // [!code highlight]
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  title!: string;
}
const Notes = client.db().model(Note);
const note = await Notes.create({ title: "Plan" }, { policy: { tenant: "acme" } });
console.log(note.tenantId);
// → acme
