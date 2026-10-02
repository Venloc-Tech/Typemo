import { type Defaulted, Entity, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";

@Schema({ collection: "accounts", tenant: true })
export class Account extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true, minLength: 1 })
  title!: string;

  @Prop(() => Number, { required: true, min: 0 })
  balance!: number;

  @Prop(() => String, { enum: ["open", "closed"] as const, default: "open" })
  status!: Defaulted<"open" | "closed">;
}
