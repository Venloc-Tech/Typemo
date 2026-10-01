# 02 Models: @Schema, @Prop, field types, markers, indexes, discriminators

Read this when declaring or changing a model class. Schemas are ES classes with decorators (legacy decorators from `@venloc/typemo`; TC39 from `@venloc/typemo-decorators`, same names and options).

## Minimal working example

```ts
import { Entity, Prop, Schema, TypemoClient, type Defaulted } from "@venloc/typemo";

@Schema({ collection: "members" })
export class Member extends Entity {
  @Prop(() => String, { required: true, trim: true, minLength: 2 })
  name!: string;

  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" })
  role!: Defaulted<"user" | "admin">;

  @Prop(() => String, { nullable: true })
  nickname?: string | null;

  @Prop(() => [String])
  tags!: string[]; // arrays default to [] without required/default
}

declare const client: TypemoClient;
const Members = client.connection.model(Member);
const member = await Members.create({ name: "Ann" }); // role "user", tags []
console.log(member.role, member.tags.length);
```

Hard rules:
- The class needs `@Schema()`; it must be constructible with no arguments.
- The type of every field is a function: `@Prop(() => String)`. Typemo never reads `design:type`.
- `required`, `nullable`, `default`, `hidden`, `immutable` are explicit options, never derived from `?`/`!`. Each is paired with a TS type marker (below); the compiler checks the pair.
- `Set`, `Map`, `Array`, `Object` are not valid field types (use `[X]`, `Spec.map(X)`, a class).

## @Schema options (SchemaOptions)

| Option | Meaning |
|---|---|
| `collection` | Collection name. Default: lowercase class name, English plural (`Account` -> `accounts`, `UserProfile` -> `userprofiles`). No `$`, no `system.` prefix. |
| `nested: true` | Nested object class: no own `_id`, hooks, discriminators or collection. Cannot be a model. |
| `discriminatorKey` | Discriminator field name, default `__t`. Must be a string field of the class. |
| `discriminators` | `() => [Card, Transfer]` list of children on the base (see Discriminators). |
| `optimisticConcurrency` | `true` or list of paths: `$save` checks the `__v` version (use with `Versioned(...)`). |
| `autoCreate`, `autoIndex` | `false` excludes the collection or its indexes from `init()`/`syncAll()` (default `true`). |
| `capped` | `{ size, max? }` capped collection. |
| `timeseries` | `{ timeField, metaField?, granularity?, expireAfterSeconds?, bucketMaxSpanSeconds?, bucketRoundingSeconds? }`; `timeField` must be a required, non-nullable `Date`. |
| `clustered` | `true` or `{ name?, expireAfterSeconds? }`. |
| `collation`, `validator`, `changeStreamPreAndPostImages`, `shardKey`, `readConcern`, `writeConcern` | Collection settings. `validator: { validationLevel?, validationAction? }` builds a closed server `$jsonSchema`. |
| `softDelete`, `tenant`, `audit` | Policies: `true` or an object (`{ field }`, `{ collection }`). `tenant` needs `@Tenant()`. |

## Base classes: Entity, EntityWithId, Timestamped, Versioned

```ts
import { Entity, EntityWithId, Prop, Schema, Timestamped, Types, Versioned } from "@venloc/typemo";

@Schema({ collection: "posts" })
export class Post extends Versioned(Timestamped(Entity)) { // _id ObjectId, createdAt, updatedAt, __v
  @Prop(() => String, { required: true })
  title!: string;
}

@Schema({ collection: "countries" })
export class Country extends EntityWithId(() => String) { // custom _id, required on create
  @Prop(() => String, { required: true })
  name!: string;
}

@Schema({ collection: "sessions" })
export class Session extends EntityWithId(() => Types.UUID, { default: () => new Types.UUID() }) {
  @Prop(() => String, { required: true })
  user!: string;
}
```

- `Entity`: `_id: ObjectId` (generated, immutable). `EntityWithId(() => Type, { default? })`: `Type` is one of `String`, `Number`, `BigInt`, `Date`, `Types.UUID`, `Types.ObjectId`, `Types.Int32`, `Types.Double`, `Types.Decimal128`. Without `default`, `_id` is required in `create`.
- `Timestamped(Base)` adds `createdAt` (set once) and `updatedAt` (moved by every write); both may be passed explicitly on create. `Versioned(Base)` adds `__v` (grows when an array position changes; with `optimisticConcurrency` on every saved change). Mixins nest in any order.
- There is no `timestamps` or `versionKey` schema option: only these base classes.

## @Prop options by type

| Field type | Options |
|---|---|
| every type | `required`, `nullable`, `default`, `immutable`, `hidden`, `sensitive`, `dbName`, `index`, `unique`, `sparse`, `validate`, `get`, `set`, `ext` |
| `String` | + `enum`, `lowercase`, `uppercase`, `trim`, `match`, `minLength`, `maxLength`, `text`, `ref`, `refPath`, `refModel` |
| `Number`, `Types.Int32`, `Types.Double` | + `enum`, `min`, `max`, `ref`, `refPath`, `refModel` |
| `BigInt` | + `min`, `max` |
| `Date` | + `min`, `max`, `expires` (seconds, TTL index) |
| `Types.ObjectId`, `Types.UUID` | + `ref`, `refPath`, `refModel` |
| class with `@Schema` | + `excludeIndexes` |
| arrays | element options apply to elements; `text`/`expires` stay on the array |

An option that does not exist for the type is a compile error on the key (`TS2353`) and a build error (`Wrong.title: "min" is not an option of this field type`).

Details worth knowing:
- `unique` needs `required: true` or `sparse: true` (or a partial `@Index`); not allowed on `nullable` fields.
- `validate: (value, context) => true | "error text"` may be async; also runs on `$set` updates (`context.kind` is `"document"` or `"update"`). It is not called for `null`.
- `get` works only through `$get` and serialization with `getters: true`; `set` runs after casting, `trim`, case.
- `sensitive`: `"show" | "mask" | "hide" | { mask: (value) => json } | Mask.email()` changes how a value looks in audit, events and error texts only. Data and query results stay real.

## Field types

```ts
import { Entity, Prop, Schema, Spec, Types, type Vector } from "@venloc/typemo";

@Schema({ collection: "samples" })
export class Sample extends Entity {
  @Prop(() => Number) n?: number;
  @Prop(() => Types.Int32) count?: number; // integers only (fraction or range overflow is CastError)
  @Prop(() => Types.Double) ratio?: number;
  @Prop(() => BigInt) big?: bigint; // int64; plain/JSON form is a decimal string (Int64String)
  @Prop(() => Types.Decimal128) price?: Types.Decimal128; // exact decimal; accepts "1.10"
  @Prop(() => Types.ObjectId) owner?: Types.ObjectId; // accepts a 24-char hex string
  @Prop(() => Types.UUID) token?: Types.UUID; // accepts a UUID string
  @Prop(() => Boolean) flag?: boolean;
  @Prop(() => Date) at?: Date;
  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 })) embedding?: Vector;
  @Prop(() => Spec.union(String, Number)) either?: string | number; // exactly one member must claim a value
  @Prop(() => Spec.map(Number)) scores?: Map<string, number>;
}
```

- `Spec.union` members must not accept the same values (`Number` + `Types.Int32` is a build error).

## Required, nullable, undefined

Three states: value, `null`, absent.

```ts
import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "profiles" })
export class Profile extends Entity {
  @Prop(() => String, { required: true }) login!: string; // present and not null
  @Prop(() => String, { nullable: true }) nickname?: string | null; // may be null or absent
  @Prop(() => String, { required: true, nullable: true }) phone!: string | null; // key required, null allowed
  @Prop(() => String) bio?: string; // may be absent, null is rejected
}
```

- `nullable: true` requires `| null` in the type and vice versa.
- `undefined` is never a value: `Cast to string | null failed at path "nickname" for undefined: undefined is never a value; omit the field instead [undefined]`. Omit the key.
- `$unset` of a required field is rejected; with `required + nullable` write `null` instead.
- Filter `{ nickname: null }` matches null and absent (server semantics); use `$exists: false` for absent only. On a non-nullable field a `null` filter is `CastError ... null is not a value of this path (it is not nullable); an absent field is { $exists: false } [null]`.

## Markers: Defaulted, Hidden, Immutable, Ref, Computed, TenantField

| Marker (TS type) | Paired with | Effect |
|---|---|---|
| `Defaulted<T>` | `default: value \| () => value` | not required in `create`; always present on read |
| `Immutable<T>` | `immutable: true` | not allowed in `$set`; runtime `StrictModeError` reason `immutable` |
| `Hidden<T>` | `hidden: true` | absent from results unless selected (`select({ "+field": true })`) |
| `Ref<M, Id?>` | `ref: () => M` (or `refPath`, `refModel`) | id that `populate` resolves; a document may be passed on write, its `_id` is stored |
| `Computed<T>` | getter without setter | computed value, not stored; in `$toPlain({ virtuals: true })` |
| `VirtualValue<T>` | getter + setter | computed value you can assign |
| `TenantField<T>` | `@Tenant()` + `@Schema({ tenant: true })` | filled by the core from the policy |
| `Discriminators<A \| B>` / `DiscriminatorValue<"x">` | discriminator key | see below |

```ts
import { Entity, Prop, Schema, Types, type Hidden, type Immutable, type Ref } from "@venloc/typemo";

@Schema({ collection: "authors" })
export class Author extends Entity {
  @Prop(() => String) name?: string;
}

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
  @Prop(() => String, { immutable: true }) country?: Immutable<string>;
  @Prop(() => Types.ObjectId, { ref: () => Author }) author?: Ref<Author>;

  get label(): string {
    return `${this.name}!`;
  }
}
```

- The default `Defaulted` rule: `default` requires `Defaulted<T>` and vice versa. Arrays are exempt: `tags!: string[]` with `default: () => ["new"]` is fine. Defaults are applied on create and upsert insert, not on plain updates, not on `lean`/`plain` reads. Functions are called per document; array literals are copied per document. `default: null` needs `nullable: true`.

```ts
import { Entity, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";

@Schema({ collection: "notes", tenant: true }) // field tenantId by default; { field: "orgId" } to rename
export class Note extends Entity {
  @Prop(() => String) @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  title!: string;
}
```

## Nested objects, subdocuments, arrays, Maps

```ts
import { Entity, Prop, Schema, Spec } from "@venloc/typemo";

@Schema({ nested: true }) // address: no own _id
class Address {
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String) street?: string;
}

@Schema() // extends Entity: a subdocument with its own _id (addressable by id)
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 1 }) qty!: number;
}

@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Address, { required: true }) shipTo!: Address;
  @Prop(() => [Line]) lines!: Line[];
  @Prop(() => [String], { enum: ["new", "sale"] as const }) labels!: ("new" | "sale")[];
  @Prop(() => [[Number]]) cells!: number[][];
  @Prop(() => Spec.map(Number)) prices?: Map<string, number>;
}
```

- Every class used as a field type needs `@Schema` (`decorate the class with @Schema()`).
- `nested: true` classes cannot declare `_id`. Choose: need to find/remove it by id -> subdocument (`extends Entity`); otherwise nested.
- Input is a plain object; no need to instantiate classes. Unknown keys are errors: `Cast to document failed at path "shipTo.zip" for "1" (string): not a field of Address [unknown-key]`.
- Paths with dots work in filters and updates: `"shipTo.city"`, `"lines.sku"`, `"prices.EUR"`. `$set: { shipTo: { city } }` replaces the whole object.
- Array errors name the index: `Cast to string failed at path "tags.1" for 5 (number): expected a string [type]`; a non-array: `Cast to Array<string> failed at path "tags" for "a" (string): expected an array [type]`.
- Arrays: no size options; use `validate` on the array field. An array field without `required`/`default` is `[]` on create and on a hydrated old document (but absent in `lean()` of an old document). `required: true` array: `create` without it fails (an empty array counts as present).
- Map keys: non-empty, no `.`, no leading `$`, not `__proto__`: `Cast to Map key failed at path "prices.a.b" for "a.b" (string): a key cannot contain "." (it would be read as a path) [key]`. Map when the keys are data; nested class when keys are known.

## Indexes

```ts
import { Entity, Index, Prop, Schema, SearchIndex } from "@venloc/typemo";

@Index({ owner: 1, createdAt: -1 }, { name: "by_owner" })
@Index({ email: 1 }, { unique: true, partialFilterExpression: { active: true }, name: "email_active" })
@Index({ title: "text", body: "text" }, { weights: { title: 5 }, default_language: "english", name: "search" })
@SearchIndex({ name: "default", definition: { mappings: { dynamic: true } } })
@Schema({ collection: "notes" })
export class Note extends Entity {
  @Prop(() => String, { index: true }) owner?: string;
  @Prop(() => Date, { expires: 3600 }) createdAt?: Date; // TTL index
  @Prop(() => String) email?: string;
  @Prop(() => Boolean) active?: boolean;
  @Prop(() => String) title?: string;
  @Prop(() => String) body?: string;
}
```

- `@Index(fields, options)`: paths are checked against the class at compile time (`@Index: "ownr" is not a field of the class`). Options: `name`, `unique`, `sparse`, `partialFilterExpression`, `expireAfterSeconds` (single `Date` field), `collation`, `weights`, `default_language`, `language_override`, `wildcardProjection`, `hidden`.
- Indexes are created only by `connection.init()` / `syncAll()` (see 01-setup). `@SearchIndex({ name, type?: "search" | "vectorSearch", definition })` is Atlas-only.

## Discriminators (several shapes in one collection)

```ts
import {
  Discriminator, Entity, Prop, Schema,
  type DiscriminatorValue, type Discriminators,
} from "@venloc/typemo";

@Schema({ collection: "payments", discriminators: () => [Card, Transfer] })
export class Payment extends Entity {
  declare readonly __t?: Discriminators<Card | Transfer>;

  @Prop(() => Number, { required: true })
  amount!: number;
}

@Discriminator("card") // literal value; no @Schema on children
export class Card extends Payment {
  declare readonly __t: DiscriminatorValue<"card">;

  @Prop(() => String, { required: true })
  last4!: string;
}

@Discriminator("transfer")
export class Transfer extends Payment {
  declare readonly __t: DiscriminatorValue<"transfer">;

  @Prop(() => String, { required: true })
  iban!: string;
}
```

- A child model sees only its documents; the base model sees all. Create a document through the child class (`model(Card).create(...)`); a document created through the base has no key.
- Without `discriminators` on the base, base results only know base fields. With it, `row.__t === "card"` narrows `plain()`/`lean()` rows.
- The key is immutable (`$set.__t: "__t" is immutable; ...`). To change the kind, create a new document and delete the old one.
- Custom key: `discriminatorKey: "kind"` in options and `declare readonly kind?: Discriminators<...>` in the class.

## Virtuals (populate-able relations)

```ts
import { Entity, Prop, Schema, Types, Virtual, type VirtualRef } from "@venloc/typemo";

@Schema({ collection: "posts" })
export class Post extends Entity {
  @Prop(() => Types.ObjectId, { required: true }) author!: Types.ObjectId;
  @Prop(() => String) title?: string;
}

@Schema({ collection: "authors" })
export class Author extends Entity {
  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author" })
  posts!: VirtualRef<Post>;

  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author", count: true })
  postCount!: VirtualRef<Post, false, true>;

}
```

- `@Virtual` fields have no `@Prop`; flags must match `VirtualRef<M, JustOne, Count>`. Also `match`, `options: { sort, skip, limit }`. Filled only by `populate`.

## Common mistakes

Bad: option without its marker type.
```ts
// @errors: 1240
import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema()
class Wrong extends Entity {
  @Prop(() => Number, { default: 5 })
  score!: number;
}
```
Good: `score!: Defaulted<number>` (message: `@Prop "score": "default" is set, declare the field as Defaulted<T>`). Same for `Hidden<T>` + `hidden: true`, `Immutable<T>` + `immutable: true`, `Ref<M>` + `ref`.

Bad: `nullable: true` with `nickname?: string` (TS1240). Good: `nickname?: string | null` (`@Prop "nickname": "nullable" is set, but the field type has no "| null"`).

Bad: unsupported type `@Prop(() => Set) tags!: Set<string>` (TS1240). Good: `@Prop(() => [String]) tags!: string[]`.

Bad: unique on an optional field.
```text
ConfigurationError: Account.nickname: "unique" on a field that is not required — every document without it is indexed as null and the second one fails (E11000); add required: true, sparse: true or use a partial @Index
```
Good: `{ unique: true, required: true }` or `{ unique: true, sparse: true }`.

Bad: typo in an option name: `@Schema({ colection: "accounts" })` is `TS2561`. Typo in a field of `@Index({ ownr: 1 })`: `@Index: "ownr" is not a field of the class`.

Bad: `@Discriminator("card")` child without the key declaration (compile error: add `declare readonly __t: DiscriminatorValue<"card">`); `@Schema` on a child (`ConfigurationError: TransferPayment: a discriminator uses its root's schema options; remove @Schema (root: Payment)`); duplicate values (`discriminator value "card" is already used by Card in the hierarchy of Payment`); child missing from the base list (`the "discriminators" list does not match the hierarchy — registered but not listed: RefundPayment`).

Bad: `@Schema({ tenant: true })` with a plain `tenantId!: string`. Good: `@Prop(() => String) @Tenant() tenantId!: TenantField<string>` (all of: field exists, has `@Tenant()`, only one `@Tenant()`).

## Self-check

- Every field has `@Prop(() => Type, ...)` and its options match the type table.
- Each of `default`/`hidden`/`immutable`/`ref`/`nullable` has its marker or `| null` in the TS type.
- `required` is explicit; `unique` fields are `required` or `sparse`.
- Subdocuments extend `Entity` only when they need an `_id`; otherwise `nested: true`. Indexes exist only after `connection.init()`.
- Discriminator children: literal value, `declare readonly __t: DiscriminatorValue<...>`, no `@Schema`, listed in the base `discriminators`.
