import { ObjectId, type UUID } from "mongodb";
import { ConfigurationError } from "../../errors/configuration-error.ts";
import type { Defaulted, Immutable } from "../../types/markers.ts";
import { MetadataBuilder } from "../metadata/metadata-builder.ts";
import type { BsonClass, EntityClass, SpecValue } from "../options/type-spec.ts";

/*
 * Service fields through inheritance: `_id`, `createdAt`/`updatedAt` and `__v` come from base classes
 * and mixins, so the entity type sees them without manual `declare`s:
 *
 *   @Schema() class User extends Versioned(Timestamped(Entity)) { … }
 *
 * The fields are FILLED BY THE CORE, never by a base constructor: with define semantics
 * (`useDefineForClassFields: true`, TC39) a redeclared field in a subclass would silently overwrite a
 * value set by the base constructor. So the bases have no constructors and no initializers; `_id`
 * has a default factory, the timestamps and the version are set by the document layer on save and
 * update.
 */

/**
 * A class that can be extended by the mixins: no-arg, abstract allowed.
 *
 * @example
 * ```ts
 * const base: Base = Entity;
 * ```
 */
type Base = EntityClass;

/**
 * The type of `Mixin(Base)`: an abstract no-arg constructor of `InstanceType<B> & F`, plus the statics
 * of `B`. Written out so the public type has no `any` (TS's own mixin pattern needs `...args: any[]`).
 *
 * @example
 * ```ts
 * type Users = Mixed<typeof Entity, TimestampFields>;
 * ```
 */
export type Mixed<B extends Base, F> = (abstract new () => InstanceType<B> & F) & { [K in keyof B]: B[K] };

/**
 * The mixin implementation needs TS's mixin constructor shape; `any[]` is required by TS2545 and stays internal.
 *
 * @example
 * ```ts
 * abstract class Timestamped extends (base as unknown as MixinBase) {}
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: TS2545 demands `any[]` for a mixin base; never exported.
type MixinBase = abstract new (...args: any[]) => object;

/**
 * Fields of `Timestamped`.
 *
 * @example
 * ```ts
 * const createdAt: TimestampFields["createdAt"] = new Date() as TimestampFields["createdAt"];
 * ```
 */
export interface TimestampFields {
  /**
   * Set once when the document is created: the operation's clock, or the date `create`/`insert*` is given (an import
   * keeps its history). Never changes afterwards (`Immutable`).
   */
  createdAt: Defaulted<Immutable<Date>>;
  /**
   * Set by every WRITE operation that reaches the document — a `save` that sends changes, `updateOne`/`updateMany`,
   * `findOneAndUpdate`, a replacement, an upsert — not only by a real change: the core does not know before the
   * write whether the server will change anything, so `$set` of the same value, `$addToSet` of a value already
   * there or `$pull` of a missing one still move `updatedAt` (and the server then reports `modifiedCount: 1`). A
   * write that sets `updatedAt` itself (create, `$set`, an assigned value in `save`) keeps the given date.
   */
  updatedAt: Defaulted<Date>;
}

/**
 * Fields of `Versioned`.
 *
 * @example
 * ```ts
 * const version: VersionFields["__v"] = 0 as VersionFields["__v"];
 * ```
 */
export interface VersionFields {
  /** Optimistic-concurrency version (Mongoose `__v`), maintained by the document layer. */
  __v: Defaulted<number>;
}

/**
 * The base of every document with an `_id` (ObjectId, generated when absent, immutable). A document with
 * another id type (a string, a number, a `UUID`) extends {@link EntityWithId} instead.
 *
 * @example
 * ```ts
 * @Schema()
 * class User extends Entity { ... }
 * ```
 */
export abstract class Entity {
  /** The document id: an ObjectId generated when absent, immutable. */
  _id!: Defaulted<Immutable<ObjectId>>;

  static {
    MetadataBuilder.for(Entity, "core").addServiceField(
      "_id",
      () => ObjectId,
      { default: () => new ObjectId(), immutable: true, required: true },
      "id",
    );
  }
}

/**
 * Adds `createdAt` / `updatedAt` (service fields filled by the core; see {@link TimestampFields} for when each
 * moves: `updatedAt` on every write operation, even one that changes nothing).
 *
 * @param base - The class to extend, for example `Entity`.
 * @returns An abstract class with the timestamp fields declared and registered as service fields.
 * @example
 * ```ts
 * @Schema()
 * class User extends Timestamped(Entity) { ... }
 * ```
 */
export const Timestamped = <B extends Base>(base: B): Mixed<B, TimestampFields> => {
  abstract class Timestamped extends (base as unknown as MixinBase) {
    static {
      const builder = MetadataBuilder.for(Timestamped, "core");
      builder.addServiceField("createdAt", () => Date, { immutable: true }, "createdAt");
      builder.addServiceField("updatedAt", () => Date, {}, "updatedAt");
    }
  }
  return Timestamped as unknown as Mixed<B, TimestampFields>;
};

/**
 * Adds the version key `__v`.
 *
 * @param base - The class to extend, for example `Entity`.
 * @returns An abstract class with the version field declared and registered as a service field.
 * @example
 * ```ts
 * @Schema({ optimisticConcurrency: true })
 * class Account extends Versioned(Entity) { ... }
 * ```
 */
export const Versioned = <B extends Base>(base: B): Mixed<B, VersionFields> => {
  abstract class Versioned extends (base as unknown as MixinBase) {
    static {
      MetadataBuilder.for(Versioned, "core").addServiceField("__v", () => Number, {}, "version");
    }
  }
  return Versioned as unknown as Mixed<B, VersionFields>;
};

/**
 * The spec of an `_id` that `EntityWithId` accepts: the scalar types MongoDB allows as a document id.
 *
 * @example
 * ```ts
 * const spec: IdSpec = String;
 * ```
 */
export type IdSpec =
  | StringConstructor
  | NumberConstructor
  | BigIntConstructor
  | DateConstructor
  | typeof UUID
  | BsonClass<"ObjectId">
  | BsonClass<"Int32">
  | BsonClass<"Double">
  | BsonClass<"Decimal128">;

/**
 * Options of `EntityWithId`.
 *
 * @typeParam Id - The type of the id.
 * @example
 * ```ts
 * const options: EntityIdOptions<string> = { default: () => crypto.randomUUID() };
 * ```
 */
export interface EntityIdOptions<Id> {
  /**
   * Generates the id of a document created without one. Without it the id is required: `create` refuses a
   * document that has none.
   */
  readonly default?: () => Id;
}

/**
 * The base class `EntityWithId` returns: an abstract no-arg class with the typed `_id`.
 *
 * @typeParam Id - The type of the id.
 * @typeParam HasDefault - Whether the id is generated when absent (optional in `create`).
 * @example
 * ```ts
 * type SessionBase = IdBase<UUID, true>;
 * ```
 */
export type IdBase<Id, HasDefault extends boolean> = abstract new () => {
  _id: HasDefault extends true ? Defaulted<Immutable<Id>> : Immutable<Id>;
};

/**
 * The overloads of `EntityWithId`: the presence of `default` decides whether the id is optional in `create`.
 *
 * @example
 * ```ts
 * const factory: EntityWithIdFactory = EntityWithId;
 * ```
 */
export interface EntityWithIdFactory {
  /**
   * A base whose `_id` is required.
   *
   * @typeParam S - The spec of the id.
   * @param type - The spec of the id, as in `@Prop(() => …)`.
   * @returns The abstract base class.
   */
  <const S extends IdSpec>(type: () => S): IdBase<SpecValue<S>, false>;
  /**
   * A base whose `_id` is generated when absent.
   *
   * @typeParam S - The spec of the id.
   * @param type - The spec of the id, as in `@Prop(() => …)`.
   * @param options - `default`: the generator of the id.
   * @returns The abstract base class.
   */
  <const S extends IdSpec>(
    type: () => S,
    options: { readonly default: () => SpecValue<S> },
  ): IdBase<SpecValue<S>, true>;
}

/**
 * The base of a document whose `_id` is not an ObjectId: the same service field as {@link Entity}'s (immutable,
 * never required in a replacement, not filled by an upsert) with the type you choose. It composes with
 * {@link Timestamped} and {@link Versioned}. `IdOf<T>`, `findById`, references, `populate`, `$out`/`$merge`
 * targets and `keysetPage` all read the type of `_id`, so they follow it.
 *
 * @param type - The spec of the id, as in `@Prop(() => …)`: `String`, `Number`, `Types.UUID`, `Date`, …
 * @param options - `default`: generates the id of a document created without one; without it `_id` is required.
 * @returns An abstract class with `_id` declared and registered as the id service field.
 * @throws {ConfigurationError} When `type` is not a function or `default` is not a function.
 * @example
 * ```ts
 * @Schema()
 * class Country extends EntityWithId(() => String) {
 *   @Prop(() => String, { required: true })
 *   name!: string;
 * }
 *
 * @Schema()
 * class Session extends Timestamped(EntityWithId(() => Types.UUID, { default: () => new UUID() })) {}
 * ```
 */
export const EntityWithId = ((
  type: () => IdSpec,
  options: { readonly default?: () => unknown } = {},
): IdBase<unknown, boolean> => {
  if (typeof type !== "function") throw new ConfigurationError("EntityWithId: the spec of the id, as () => String");
  if (options.default !== undefined && typeof options.default !== "function") {
    throw new ConfigurationError("EntityWithId: `default` is a function that generates the id");
  }
  abstract class Identified {
    static {
      MetadataBuilder.for(Identified, "core").addServiceField(
        "_id",
        type,
        {
          ...(options.default === undefined ? {} : { default: options.default }),
          immutable: true,
          required: true,
        },
        "id",
      );
    }
  }
  return Identified as unknown as IdBase<unknown, boolean>;
  /* The overloads tie the id type to the spec and `default` to optionality; one implementation serves both. */
}) as unknown as EntityWithIdFactory;
