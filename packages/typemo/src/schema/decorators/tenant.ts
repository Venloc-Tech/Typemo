import { ConfigurationError } from "../../errors/configuration-error.ts";
import { MetadataBuilder } from "../metadata/metadata-builder.ts";
import type { ClassRef } from "../metadata/metadata-types.ts";
import type { TenantCheck } from "./class-checks.ts";
import { DecoratorGuard } from "./decorator-guard.ts";

/**
 * Marks the tenant field of a tenant-scoped schema, next to its `@Prop(...)`. The field type must be
 * `TenantField<T>` (checked at the decorator); the schema must have the `tenant` policy naming this field (checked
 * by `@Schema` in the types and by the schema build at run time: a `tenant` option whose field is not marked, or a
 * mark without the option, is a `ConfigurationError`). The mark is what the run time sees of `TenantField<T>`.
 *
 * @returns A property decorator that records the mark in the class metadata.
 * @throws {ConfigurationError} From the returned decorator, when applied to a static member, a method or an
 * accessor, twice on one field, or when mixed with TC39 decorators.
 * @example
 * ```ts
 * @Schema({ collection: "notes", tenant: true })
 * class Note extends Entity {
 *   @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
 *   @Prop(() => String, { required: true }) title!: string;
 * }
 * ```
 */
export const Tenant =
  () =>
  <T extends object, K extends string>(target: T & TenantCheck<T, K>, key: K, descriptor?: unknown): void => {
    DecoratorGuard.assertLegacy("@Tenant", key);
    const owner: object = target;
    if (typeof owner === "function") {
      throw new ConfigurationError(`${(owner as ClassRef).name}: @Tenant on static member "${key}"`);
    }
    const ctor = (owner as { constructor: ClassRef }).constructor;
    if (descriptor !== undefined) {
      throw new ConfigurationError(`${ctor.name}: @Tenant on "${key}", which is a method or an accessor`);
    }
    MetadataBuilder.for(ctor).markTenantField(key);
  };
