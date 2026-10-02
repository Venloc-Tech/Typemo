import { Entity, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";

@Schema({ collection: "orders", tenant: true })
export class Order extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  number!: string;
}
