// @errors: 1238
import { Entity, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";
// ---cut---
@Schema({ collection: "notes", tenant: true })
class Note extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String) @Tenant() author!: TenantField<string>;
}
// compiler: @Schema: "author" is TenantField<T>, but the tenant field is "tenantId"
