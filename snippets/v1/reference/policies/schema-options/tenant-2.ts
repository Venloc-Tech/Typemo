import { Entity, Prop, Schema, Types, Tenant, type TenantField } from "@venloc/typemo";

@Schema({ collection: "org_accounts", tenant: { field: "orgId" } })
export class OrgAccount extends Entity {
  @Prop(() => Types.ObjectId)
  @Tenant()
  orgId!: TenantField<Types.ObjectId>;

  @Prop(() => String, { required: true })
  title!: string;
}
