/*
 * The `TenantField<T>` marker. The core fills the tenant field from the operation's tenant, so `create()` /
 * `insert*` / a replacement do not require it; every read form has it (required, markers removed).
 * `@Schema({ tenant })` checks that the marker sits exactly on the tenant field, and `@Tenant()` (its run-time twin)
 * sits only on a `TenantField<T>` field (the messages: hover test
 * hover/mechanisms/tenant-field-hover.test.ts).
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import {
  Entity,
  type HydratedDoc,
  type Lean,
  type Model,
  Prop,
  Schema,
  Tenant,
  type TenantField,
  Types,
} from "../../../src/index.ts";

@Schema({ collection: "m5_invoices", tenant: true })
class Invoice extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => Number, { required: true }) total!: number;
}

@Schema({ collection: "m5_orgdocs", tenant: { field: "org" } })
class OrgDoc extends Entity {
  @Prop(() => Types.ObjectId) @Tenant() org!: TenantField<ObjectId>;
  @Prop(() => String, { required: true }) body!: string;
}

declare const Invoices: Model<Invoice>;
declare const OrgDocs: Model<OrgDoc>;

// Positive: create / insert / replace do not require the tenant field …
Invoices.create({ total: 1 });
Invoices.insertOne({ total: 1 });
Invoices.insertMany([{ total: 1 }, { total: 2, tenantId: "acme" }]);
Invoices.replaceOne({ total: 1 }, { total: 2 });
OrgDocs.create({ body: "b" });
// … but accept it with its value type.
Invoices.create({ total: 1, tenantId: "acme" });

// Positive: every read form has it, required, without the marker.
expectTypeOf<Lean<Invoice>["tenantId"]>().toEqualTypeOf<string>();
expectTypeOf<Lean<Invoice>>().toEqualTypeOf<{ _id: ObjectId; tenantId: string; total: number }>();
expectTypeOf<Lean<OrgDoc>["org"]>().toEqualTypeOf<ObjectId>();
declare const hydrated: HydratedDoc<Invoice>;
const tenant: string = hydrated.tenantId;
void tenant;
// Filters and sorts take the plain value.
Invoices.find({ tenantId: "acme" });
Invoices.find().sort({ tenantId: 1 });

// Negative: the wrong value type on create.
// @ts-expect-error — the tenant field is a string
Invoices.create({ total: 1, tenantId: 5 });

// Negative: the tenant field declared without the marker.
// @ts-expect-error — declare the tenant field as tenantId!: TenantField<T>
@Schema({ collection: "m5_plain", tenant: true })
class PlainTenant extends Entity {
  @Prop(() => String, { required: true }) tenantId!: string;
}

// Negative: the marker on another field than the tenant field.
// @ts-expect-error — "owner" is TenantField<T>, but the tenant field is "tenantId"
@Schema({ collection: "m5_other", tenant: true })
class OtherField extends Entity {
  @Prop(() => String) tenantId!: TenantField<string>;
  @Prop(() => String) owner!: TenantField<string>;
}

// Negative: the marker without a tenant option.
// @ts-expect-error — "tenantId" is TenantField<T>, but the schema has no tenant option
@Schema({ collection: "m5_none" })
class NoTenant extends Entity {
  @Prop(() => String) tenantId!: TenantField<string>;
}

// Negative: @Tenant() on a field that is not declared TenantField<T>.
@Schema({ collection: "m5_mark", tenant: true })
class WrongMark extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  // @ts-expect-error — @Tenant "title": declare the field as TenantField<T>
  @Prop(() => String) @Tenant() title!: string;
}

void [PlainTenant, OtherField, NoTenant, WrongMark];
