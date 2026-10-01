import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for a `TenantField<T>` in the read and create forms, and the readable errors of a tenant
 * field without the marker, a marker off the tenant field, and `@Tenant()` on a field that is not `TenantField<T>`.
 */

const IMPORTS = `
import { Entity, Prop, Schema, Tenant, type TenantField, type Lean, type CreateInput } from "@venloc/typemo";
`;

describe("hover: TenantField", () => {
  test("read: required, the plain value", () => {
    expectHover(`${IMPORTS}
@Schema({ collection: "m5h_a", tenant: true }) class A extends Entity { @Prop(() => String) @Tenant() tenantId!: TenantField<string>; }
declare const a: Lean<A>;
const tenant = a.tenantId;
//    ^?`).toBe("const tenant: string");
  });

  test("create: optional", () => {
    expectHover(`${IMPORTS}
@Schema({ collection: "m5h_b", tenant: true }) class B extends Entity { @Prop(() => String) @Tenant() tenantId!: TenantField<string>; }
declare const input: CreateInput<B>;
const tenant = input.tenantId;
//    ^?`).toBe("const tenant: string | undefined");
  });

  test("a tenant field without the marker", () => {
    expectTypeError(`${IMPORTS}
@Schema({ collection: "m5h_c", tenant: true }) class C extends Entity { @Prop(() => String) tenantId!: string; }`).toContain(
      "@Schema: declare the tenant field as tenantId!: TenantField<T>",
    );
  });

  test("the marker on another field", () => {
    expectTypeError(`${IMPORTS}
@Schema({ collection: "m5h_d", tenant: { field: "org" } }) class D extends Entity {
  @Prop(() => String) org!: TenantField<string>;
  @Prop(() => String) owner!: TenantField<string>;
}`).toContain('@Schema: \\"owner\\" is TenantField<T>, but the tenant field is \\"org\\"');
  });

  test("@Tenant() on a field that is not TenantField<T>", () => {
    expectTypeError(`${IMPORTS}
@Schema({ collection: "m5h_e", tenant: true }) class E extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String) @Tenant() title!: string;
}`).toContain('@Tenant \\"title\\": declare the field as TenantField<T>');
  });
});
