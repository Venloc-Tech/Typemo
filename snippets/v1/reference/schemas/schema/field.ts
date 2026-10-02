import { Entity, Prop, Schema, Tenant, TypemoClient, type TenantField } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ tenant: { field: "orgId" }, softDelete: { field: "removedAt" } }) // [!code highlight]
class Doc extends Entity {
  @Prop(() => String) @Tenant() orgId!: TenantField<string>;
  @Prop(() => Date, { nullable: true }) removedAt!: Date | null;
}
