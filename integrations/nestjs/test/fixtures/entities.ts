// The entities of the package's tests (names start with `Nt`: the metadata store is global for the process).
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  EntityWithId,
  type Model,
  Plugin,
  Prop,
  Schema,
  type SchemaPlugin,
  Tenant,
  type TenantField,
  Timestamped,
  Types,
} from "@venloc/typemo";

@Schema({ collection: "nt_accounts" })
export class NtAccount extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true, min: 0 })
  balance!: number;

  @Prop(() => String)
  owner?: string;
}

@Schema({ collection: "nt_users" })
export class NtUser extends Timestamped(Entity) {
  @Prop(() => String, { required: true, unique: true })
  email!: string;

  @Prop(() => String, { required: true, minLength: 2 })
  name!: string;

  @Prop(() => Number, { min: 0, max: 150 })
  age?: number;

  @Prop(() => String, { enum: ["user", "admin"] as const })
  role?: "user" | "admin";

  @Prop(() => String, { sensitive: "mask" })
  phone?: string;
}

@Schema({ collection: "nt_countries" })
export class NtCountry extends EntityWithId(() => String) {
  @Prop(() => String, { required: true })
  name!: string;
}

@Schema({ collection: "nt_tickets" })
export class NtTicket extends EntityWithId(() => Number) {
  @Prop(() => String, { required: true })
  subject!: string;
}

@Schema({ collection: "nt_sessions" })
export class NtSession extends EntityWithId(() => Types.UUID) {
  @Prop(() => String)
  device?: string;
}

@Schema({ collection: "nt_events" })
export class NtEvent extends Entity {
  declare readonly __t?: DiscriminatorValue<"click" | "signup">;

  @Prop(() => Date, { required: true })
  time!: Date;
}

@Discriminator("click")
export class NtClickEvent extends NtEvent {
  declare readonly __t: DiscriminatorValue<"click">;

  @Prop(() => String, { required: true })
  url!: string;
}

@Discriminator("signup")
export class NtSignUpEvent extends NtEvent {
  declare readonly __t: DiscriminatorValue<"signup">;

  @Prop(() => String, { required: true })
  user!: string;
}

@Schema({ collection: "nt_orders", tenant: true })
export class NtOrder extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  number!: string;
}

/** A plugin with a static, for `forFeature([{ entity, statics }])`. */
export const NtCountPlugin = {
  name: "nt-count",
  apply: () => undefined,
  statics: {
    countTitled(this: Model<object>, title: string): Promise<number> {
      /* cast: a plugin static is typed on Model<object>; here it runs on the NtAccount model */
      return (this as unknown as Model<NtAccount>).countDocuments({ title });
    },
  },
} satisfies SchemaPlugin<undefined, object>;

@Plugin(NtCountPlugin)
@Schema({ collection: "nt_notes" })
export class NtNote extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

@Schema({ collection: "nt_open_accounts" })
export class NtOpenAccount extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  balance!: number;
}

@Schema({ collection: "nt_owner_totals" })
export class NtOwnerTotal extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true })
  total!: number;
}
