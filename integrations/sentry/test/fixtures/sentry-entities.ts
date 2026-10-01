// Fixtures for the Sentry adapter's runtime tests : one schema that can trigger a
// `ValidationError`, a `CastError` and (via its unique index) a `DuplicateKeyError`.
import { Entity, Index, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";

@Schema({ collection: "sentry_items" })
@Index({ slug: 1 }, { unique: true })
export class Item extends Entity {
  @Prop(() => String, { required: true, minLength: 1 })
  slug!: string;

  @Prop(() => Number, { min: 0 })
  score?: number;

  // The `sensitive` field modes.
  @Prop(() => String, { sensitive: "mask", minLength: 3 })
  pin?: string;

  @Prop(() => String, { sensitive: "hide" })
  internal?: string;

  @Prop(() => String, { sensitive: { mask: (value: string) => `${value.slice(0, 2)}***` } })
  email?: string;

  @Prop(() => String, { sensitive: "show" })
  city?: string;
}

// A unique field marked "hide" — its value must never reach a captured event (DuplicateKeyError).
@Schema({ collection: "sentry_secret_items" })
export class SecretItem extends Entity {
  @Prop(() => String, { required: true, unique: true, sensitive: "hide" })
  token!: string;
}

// A tenant-scoped model: the operation's tenant reaches the captured error only with `includeTenant: true`.
@Schema({ collection: "sentry_tenant_items", tenant: true })
export class TenantItem extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true, minLength: 1 })
  slug!: string;
}
