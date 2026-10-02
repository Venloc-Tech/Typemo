import { Entity, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";

@Schema({ collection: "orders", tenant: true, softDelete: true, audit: true })
export class Order extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  number!: string;

  @Prop(() => Number, { required: true, min: 0 })
  total!: number;

  @Prop(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
