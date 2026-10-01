/*
 * Entities of the application policies (tenant, soft delete, audit) and of the hook runtime.
 * Every policy is off unless the schema enables it; `Label` has none (a join target that is not scoped).
 */
import {
  Entity,
  type Hidden,
  Prop,
  type Ref,
  Schema,
  Tenant,
  type TenantField,
  Timestamped,
  Types,
} from "../../../src/index.ts";

/** A subdocument with a secret (audit masking inside documents and updates). */
@Schema()
export class Credential {
  @Prop(() => String, { required: true }) kind!: string;
  @Prop(() => String, { sensitive: "mask" }) token?: string;
}

/** Tenant-scoped, soft-deleted and audited folder (a join target). */
@Schema({ collection: "m9_folders", tenant: true, softDelete: true })
export class Folder extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}

/** Not scoped (a join target without policies). */
@Schema({ collection: "m9_labels" })
export class Label extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}

/** Everything at once: tenant, soft delete, audit with masked/omitted fields. */
@Schema({ collection: "m9_notes", tenant: true, softDelete: true, audit: true })
export class Note extends Timestamped(Entity) {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number) rank?: number;
  @Prop(() => String, { sensitive: "mask" }) secret?: string;
  @Prop(() => String, { sensitive: "hide" }) internal?: string;
  @Prop(() => String, { hidden: true }) hiddenNote?: Hidden<string>;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
  @Prop(() => Types.ObjectId, { ref: () => Folder }) folder?: Ref<Folder>;
  @Prop(() => [Credential]) credentials?: Credential[];
}

/** Tenant only, the field with another name and type (an ObjectId, cast from the context). */
@Schema({ collection: "m9_orgdocs", tenant: { field: "org" } })
export class OrgDoc extends Entity {
  @Prop(() => Types.ObjectId) @Tenant() org!: TenantField<Types.ObjectId>;
  @Prop(() => String, { required: true }) body!: string;
}

/** Soft delete only, the field renamed; a unique index for the hint. */
@Schema({ collection: "m9_accounts", softDelete: { field: "removedAt" } })
export class Account9 extends Entity {
  @Prop(() => String, { required: true, unique: true }) email!: string;
  @Prop(() => Date, { nullable: true }) removedAt?: Date | null;
}

/** Audit only, into its own collection. */
@Schema({ collection: "m9_payments", audit: { collection: "m9_payments_trail" } })
export class Payment extends Entity {
  @Prop(() => Number, { required: true }) amount!: number;
  @Prop(() => String, { sensitive: "mask" }) card?: string;
}
