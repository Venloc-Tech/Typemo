/**
 * Adapter entry (`@venloc/typemo/adapters`): the mechanism a decorator package uses to feed schema metadata
 * into the core: the same `MetadataBuilder` the legacy decorators call, plus the metadata-source hook for
 * metadata that lives outside the core store (TC39 `Symbol.metadata`).
 *
 * Not part of the application API (`src/index.ts`); kept separate so the public export list is unchanged.
 *
 * @packageDocumentation
 */
import { MetadataStore } from "./schema/metadata/metadata-store.ts";
import type { ClassRef } from "./schema/metadata/metadata-types.ts";

export { DecoratorGuard } from "./schema/decorators/decorator-guard.ts";
export { MetadataBuilder } from "./schema/metadata/metadata-builder.ts";
export type { MetadataOrigin } from "./schema/metadata/metadata-store.ts";

/** Metadata sources of the core store: how a decorator package plugs its own metadata storage into the core. */
export class MetadataSources {
  /**
   * Registers a metadata source.
   *
   * @param load - Called with a class, once per class, before the core first reads that class record;
   *   it copies the metadata it holds for the class into the core store.
   */
  static add(load: (target: ClassRef) => void): void {
    MetadataStore.addSource(load);
  }

  /**
   * Tells whether the core store already holds records for a class.
   *
   * @param target - The class to check.
   * @returns `true` when the class has records in the core store (written by any source).
   */
  static hasRecords(target: ClassRef): boolean {
    const own = MetadataStore.own(target);
    return (
      own.schema !== undefined ||
      own.discriminator !== undefined ||
      own.fields.length > 0 ||
      own.indexes.length > 0 ||
      own.virtuals.length > 0 ||
      own.hooks.length > 0 ||
      own.plugins.length > 0 ||
      own.tenantFields.length > 0
    );
  }
}

/* Compile-time checks and option types a decorator package applies: the same ones as the legacy decorators,
   so both packages accept exactly the same options (all options live in the core). */
export type { HookArgs, HookEvent, HookPhase, HookThisOf } from "./hooks/hook-events.ts";
export type {
  DiscriminatorCheck,
  HookCheck,
  IndexCheck,
  SchemaCheck,
  TenantCheck,
  VirtualCheck,
} from "./schema/decorators/class-checks.ts";
export type { PropCheck } from "./schema/decorators/prop-check.ts";
export type { ClassRef, HookFunction, SchemaPlugin } from "./schema/metadata/metadata-types.ts";
export type { IndexFields, IndexOptions, SearchIndexOptions } from "./schema/options/index-options.ts";
export type { NoExtraOptions, PropOptions } from "./schema/options/prop-options.ts";
export type { SchemaOptions } from "./schema/options/schema-options.ts";
export type { EntityClass, TypeSpec } from "./schema/options/type-spec.ts";
export type { VirtualOptions } from "./schema/options/virtual-options.ts";
