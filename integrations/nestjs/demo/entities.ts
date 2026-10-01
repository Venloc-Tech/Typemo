// The demo's model: a bank with accounts of organizations (tenants) and an audit-free transfer log.
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Prop,
  type Ref,
  Schema,
  Tenant,
  type TenantField,
  Types,
} from "@venloc/typemo";

@Schema({ collection: "demo_customers" })
export class Customer extends Entity {
  @Prop(() => String, { required: true, unique: true })
  email!: string;

  @Prop(() => String, { required: true, minLength: 2 })
  name!: string;
}

@Schema({ collection: "demo_accounts", tenant: true })
export class Account extends Entity {
  declare readonly __t?: DiscriminatorValue<"savings">;

  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true, min: 0 })
  balance!: number;

  @Prop(() => Types.ObjectId, { ref: () => Customer })
  owner?: Ref<Customer>;
}

@Discriminator("savings")
export class SavingsAccount extends Account {
  declare readonly __t: DiscriminatorValue<"savings">;

  @Prop(() => Number, { required: true })
  rate!: number;
}
