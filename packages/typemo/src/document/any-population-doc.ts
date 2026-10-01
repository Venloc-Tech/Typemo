import type { ClientSession } from "mongodb";
import type {
  IsVirtualRef,
  RefModel,
  Unbranded,
  VirtualRefCount,
  VirtualRefJustOne,
  VirtualRefModel,
} from "../types/markers.ts";
import type { DeleteResult } from "../types/result.ts";
import type { DataKeys } from "../types/schema-paths.ts";
import type { EmbeddedClass, HydratedField, IsEmbedded } from "./collections/hydrated-types.ts";
import type { DocumentChanges, HiddenKeys, SaveOptions, SerializeOptions } from "./document-types.ts";

/*
 * The form of a hydrated document in ANY population state (R61): one type that a plain `HydratedDoc<T>` and every
 * populated document of `T` (nested populate included) are assignable to. `HydratedDoc<T>` itself is not touched:
 * a second type parameter on it would make it a conditional type, and the IDE would then print the resolved
 * intersection instead of `HydratedDoc<User>` (checked with the compiler), so the form has its own name.
 *
 * `DocumentMethods<in out T>` is invariant (its `T` sits in parameters and results), so the methods are a separate,
 * small interface of the members whose meaning does not depend on the population state.
 */

/**
 * A reference in any population state: the stored id, a document of the referenced model (in any population
 * state itself), or `null` (the referenced document is gone, or a `match` left it out).
 *
 * @example
 * ```ts
 * type A = AnyRef<Ref<Person>>; // Ref<Person> | AnyPopulationDoc<Person> | null
 * ```
 */
type AnyRef<V> = V extends null | undefined ? V : Unbranded<V> | AnyPopulationDoc<RefModel<V>> | null;

/**
 * A populated reference: a document of the referenced model, or `null`.
 *
 * @example
 * ```ts
 * type A = PopulatedRef<Ref<Person>>; // AnyPopulationDoc<Person> | null
 * ```
 */
type PopulatedRef<V> =
  /* Distributive on purpose: a union that is the whole body of an alias is printed by the alias name in the IDE. */
  V extends unknown ? AnyPopulationDoc<RefModel<V>> | null : never;

/**
 * An embedded document (or nested object) in any population state: its fields only, references inside it widened.
 *
 * @example
 * ```ts
 * type A = AnyEmbedded<Line>; // { readonly product: Ref<Product> | AnyPopulationDoc<Product> | null; readonly qty: number }
 * ```
 */
type AnyEmbedded<E> = AnyPopulationFields<EmbeddedClass<E>, never>;

/**
 * A declared data field `V` in any population state: references (single, arrays, Map values) widened by
 * {@link AnyRef}, embedded documents walked, every other field as in `HydratedDoc<T>`. Containers are read-only:
 * this form does not know which values the field holds, so it cannot take writes.
 *
 * @example
 * ```ts
 * type A = AnyField<Ref<Tag>[]>; // readonly (Ref<Tag> | AnyPopulationDoc<Tag> | null)[]
 * type B = AnyField<string>; // string
 * ```
 */
type AnyField<V> = V extends null | undefined
  ? V
  : [RefModel<V>] extends [never]
    ? V extends ReadonlyMap<string, infer E>
      ? [RefModel<E>] extends [never]
        ? IsEmbedded<EmbeddedClass<E>> extends true
          ? ReadonlyMap<string, AnyEmbedded<E>>
          : HydratedField<V>
        : ReadonlyMap<string, AnyRef<NonNullable<E>>>
      : V extends readonly (infer E)[]
        ? IsEmbedded<EmbeddedClass<E>> extends true
          ? readonly AnyEmbedded<E>[]
          : HydratedField<V>
        : IsEmbedded<EmbeddedClass<V>> extends true
          ? AnyEmbedded<V>
          : HydratedField<V>
    : V extends readonly (infer E)[]
      ? readonly AnyRef<NonNullable<E>>[]
      : AnyRef<V>;

/**
 * A populated data field `V` (after {@link isPopulated}): the documents in place of the ids. Array elements and
 * Map values keep `null` (`retainNullValues`, a gone document in a Map).
 *
 * @example
 * ```ts
 * type A = PopulatedData<Ref<Tag>[]>; // readonly (AnyPopulationDoc<Tag> | null)[]
 * ```
 */
type PopulatedData<V> =
  NonNullable<V> extends ReadonlyMap<string, infer E>
    ? ReadonlyMap<string, PopulatedRef<NonNullable<E>>>
    : NonNullable<V> extends readonly (infer E)[]
      ? readonly PopulatedRef<NonNullable<E>>[]
      : PopulatedRef<NonNullable<V>>;

/**
 * A populated populate virtual: a count, one document or `null` (`justOne`), or a list of documents.
 *
 * @example
 * ```ts
 * type A = PopulatedVirtual<VirtualRef<Post>>; // readonly AnyPopulationDoc<Post>[]
 * ```
 */
type PopulatedVirtual<V> =
  VirtualRefCount<V> extends true
    ? number
    : VirtualRefJustOne<V> extends true
      ? AnyPopulationDoc<VirtualRefModel<V>> | null
      : readonly AnyPopulationDoc<VirtualRefModel<V>>[];

/**
 * One member of the form: a populate virtual (its declared marker while not populated, or its populated value),
 * a data field ({@link AnyField}), or a method / getter of the class as declared.
 *
 * @example
 * ```ts
 * type A = AnyMember<Post, "author">; // Ref<Person> | AnyPopulationDoc<Person> | null
 * ```
 */
type AnyMember<T, K extends keyof T> =
  IsVirtualRef<T[K]> extends true
    ? T[K] | PopulatedVirtual<NonNullable<T[K]>>
    : K extends DataKeys<T>
      ? AnyField<T[K]>
      : T[K];

/**
 * A member known to be populated (after {@link isPopulated}).
 *
 * @example
 * ```ts
 * type A = PopulatedMember<Post, "author">; // AnyPopulationDoc<Person> | null
 * ```
 */
type PopulatedMember<T, K extends keyof T> =
  IsVirtualRef<T[K]> extends true ? PopulatedVirtual<NonNullable<T[K]>> : PopulatedData<T[K]>;

/**
 * The keys of `T` that populate can fill: references (single, arrays, Map values) and populate virtuals.
 *
 * @example
 * ```ts
 * type K = PopulatableKeys<Post>; // "author" | "tags" | "comments"
 * ```
 */
export type PopulatableKeys<T> = {
  [K in keyof T & string]-?: IsVirtualRef<T[K]> extends true
    ? K
    : K extends DataKeys<T>
      ? [RefModel<T[K]>] extends [never]
        ? NonNullable<T[K]> extends ReadonlyMap<string, infer E>
          ? [RefModel<E>] extends [never]
            ? never
            : K
          : never
        : K
      : never;
}[keyof T & string];

/**
 * Phantom key (type only, never present at run time) of {@link AnyPopulationDoc}: the entity class and the keys
 * known to be populated, read back by `isPopulated`. The keys sit in a parameter position, so a document that
 * knows more populated keys stays assignable to one that knows fewer.
 */
export declare const ANY_POPULATION: unique symbol;

/**
 * The phantom member of the form (see {@link ANY_POPULATION}).
 *
 * @example
 * ```ts
 * type A = AnyPopulationPhantom<Post, "author">;
 * ```
 */
export interface AnyPopulationPhantom<T, P extends string> {
  /** Phantom (type only, never present at run time): `[entity, (populated keys) => void]`. */
  readonly [ANY_POPULATION]?: readonly [T, (populated: P) => void];
}

/**
 * The entity class and the known populated keys of a document of the form (`[unknown, never]` for other types).
 *
 * @example
 * ```ts
 * type A = AnyPopulationOf<PartlyPopulatedDoc<Post, "author">>; // [Post, "author"]
 * ```
 */
export type AnyPopulationOf<D> =
  D extends AnyPopulationPhantom<infer T, infer P> ? (unknown extends T ? [unknown, never] : [T, P]) : [unknown, never];

/**
 * The fields of the form: read-only; `Hidden` fields optional (a read without them is a document of `T` too);
 * the keys in `P` in their populated form and present.
 *
 * @example
 * ```ts
 * type F = AnyPopulationFields<Post, "author">;
 * ```
 */
type AnyPopulationFields<T, P extends string> = T extends unknown
  ? AnyPopulationPhantom<T, P> & {
      readonly [K in keyof T as K extends P ? never : K extends HiddenKeys<T> ? never : K]: AnyMember<T, K>;
    } & {
      readonly [K in keyof T as K extends P ? never : K extends HiddenKeys<T> ? K : never]?: AnyMember<T, K>;
    } & {
      readonly [K in keyof T as K extends P ? K : never]-?: PopulatedMember<T, K>;
    }
  : never;

/**
 * The document methods of the form: the members that mean the same in every population state. The
 * serializations return a wide object (a populated field serializes as a document, an unpopulated one as an id).
 *
 * @example
 * ```ts
 * declare const post: AnyPopulationDoc<Post>;
 * if (post.$isModified()) await post.$save();
 * ```
 */
export interface AnyPopulationMethods {
  /** `true` until the document is inserted (a new document from `model.new()`). */
  $isNew(): boolean;
  /** Free space for the application (the same object on every call), never saved. */
  $locals(): Record<string, unknown>;
  /**
   * Whether anything (or `path`, or something under it) changed since the last load or save.
   *
   * @param path - Limits the check to this path.
   */
  $isModified(path?: string): boolean;
  /**
   * The update the next save would send (code names), without side effects; see `HydratedDoc#$getChanges`.
   */
  $getChanges(): DocumentChanges;
  /**
   * Validates the whole document (every issue in one `ValidationError`).
   *
   * @throws {CastError} When a directly assigned value cannot be cast.
   * @throws {ValidationError} When any field is invalid.
   */
  $validate(): Promise<void>;
  /**
   * Inserts (new) or updates (the changes only); a populated field is saved as its ids.
   *
   * @param options - Session, timeout and policy of the write.
   * @returns This document.
   * @throws {ValidationError} When the document is invalid.
   */
  $save(options?: SaveOptions): Promise<this>;
  /**
   * Deletes the document by `_id`.
   *
   * @param options - Session, timeout and policy of the write.
   */
  $deleteOne(options?: SaveOptions): Promise<DeleteResult>;
  /**
   * Plain data: arrays, `Map`s, plain objects; BSON values as they are.
   *
   * @param options - Serialization options.
   */
  $toObject(options?: SerializeOptions): Record<string, unknown>;
  /**
   * The JSON form: ids, dates, int64 as strings, Maps as records.
   *
   * @param options - Serialization options.
   */
  $toJSON(options?: SerializeOptions): Record<string, unknown>;
  /**
   * The plain form: the MongoDB types as strings, the native types kept.
   *
   * @param options - Serialization options.
   */
  $toPlain(options?: SerializeOptions): Record<string, unknown>;
  /**
   * The stored ids behind a populated path (a copy); `undefined` when the path is not populated.
   *
   * @param path - The populated path.
   */
  $populated(path: string): unknown;
  /** The session the document was loaded in (or set), used by `$save` when none is passed. */
  $session(): ClientSession | undefined;
  /**
   * Sets (or with `null` clears) the document's session.
   *
   * @param session - The session, or `null` to clear it.
   * @returns This document.
   */
  $session(session: ClientSession | null): this;
}

/**
 * A hydrated document of `T` in ANY population state: a plain `HydratedDoc<T>` and every populated document of
 * `T` (nested populate included) are assignable to it. A reference reads as `Ref<M> | AnyPopulationDoc<M> | null`
 * (arrays: per element; Map values alike), a populate virtual as its marker or its populated value; the fields are
 * read-only and `Hidden` fields optional. Narrow a reference with `isPopulated` (it gives a
 * {@link PartlyPopulatedDoc}).
 *
 * Not covered: a populate with `select` (fields missing), `transform` (other values) or `justOne` over an array
 * of references (one document instead of a list): such documents are not assignable.
 *
 * @typeParam T - The entity class.
 * @example
 * ```ts
 * const title = (post: AnyPopulationDoc<Post>): string =>
 *   isPopulated(post, "author") ? `${post.title} by ${post.author?.name ?? "?"}` : post.title;
 * declare const id: ObjectId;
 * title(await Posts.findById(id).orFail());
 * title(await Posts.findById(id).populate("author").orFail());
 * ```
 */
export type AnyPopulationDoc<T> = AnyPopulationFields<T, never> & AnyPopulationMethods;

/**
 * A document of `T` in any population state whose keys `P` are known to be populated (what `isPopulated` narrows
 * to): those keys read as documents (or `null`), the rest as in {@link AnyPopulationDoc}, which it is assignable to.
 * A separate name, not a second parameter of `AnyPopulationDoc`: a default argument is printed by the IDE
 * (`AnyPopulationDoc<Person, never>`) wherever the type is computed rather than written.
 *
 * @typeParam T - The entity class.
 * @typeParam P - The keys known to be populated.
 * @example
 * ```ts
 * declare const post: AnyPopulationDoc<Post>;
 * if (isPopulated(post, "author")) {
 *   const known: PartlyPopulatedDoc<Post, "author"> = post;
 * }
 * ```
 */
export type PartlyPopulatedDoc<T, P extends string> = AnyPopulationFields<T, P> & AnyPopulationMethods;
