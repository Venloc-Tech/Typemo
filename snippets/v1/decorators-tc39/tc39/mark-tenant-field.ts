import { Entity, type TenantField } from "@venloc/typemo";
import { Prop, Schema, Tenant } from "@venloc/typemo-decorators";

@Schema({ collection: "notes", tenant: true })
export class Note extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  text!: string;
}
