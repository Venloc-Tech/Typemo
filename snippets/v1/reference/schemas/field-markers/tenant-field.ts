import { Entity, Prop, Schema, Tenant, TypemoClient, type TenantField } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
// @errors: 1238
@Schema({ tenant: true })
class Doc extends Entity {
  @Prop(() => String)
  tenantId!: string;
}
