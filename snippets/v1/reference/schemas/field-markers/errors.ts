import { Entity, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";
// ---cut---
// @errors: 1240
@Schema({ tenant: true })
class Note extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String) @Tenant() title!: string;
}
