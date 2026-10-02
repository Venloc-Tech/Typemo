import { Entity, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";

@Schema({ collection: "accounts", tenant: true })
export class Account extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  title!: string;
}
