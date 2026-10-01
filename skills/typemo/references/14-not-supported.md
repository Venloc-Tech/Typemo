# Mongoose features Typemo does not have, and what to write instead

Read this when porting Mongoose code or when you reach for a Mongoose habit. None of the missing items is an oversight: each one hides behaviour from the reader of the code (silent cast, silent drop, silent skip). Never emulate them with `as never` or `unsafeDriver()` unless the user asks.

## Quick map

| Mongoose | Typemo |
|---|---|
| `Mixed`, `Object`, `{}`, untyped array field | nested `@Schema({ nested: true })` class, or `Spec.map(T)` |
| `strict: false`, `strictQuery`, `strictPopulate`, `useNestedStrict`, `sanitizeFilter` | none. Unknown path/key is an error |
| `select("a -b")`, `sort("-age name")` (strings) | objects: `select({ a: 1 })`, `sort({ age: -1, name: 1 })` |
| `next()`, callbacks | async methods and exceptions |
| `this` is a `Query` in query hooks | `this: OperationHookContext<T, "query.find">`; change with `this.modify(...)`, skip with `this.skip(...)` |
| `schema.pre(/^find/, fn)` | one decorator per event: `@Pre("query.find")`, `@Pre("query.findOne")` ... (`HOOK_EVENTS`) |
| `schema.plugin(fn)`, `mongoose.plugin(fn)` | `@Plugin(plugin)` / `Typemo.plugin(plugin)` where a plugin is `{ name, apply(builder, options) }` |
| soft-delete, tenant, history plugins | built-in policies: `softDelete`, `tenant` + `@Tenant()`, `audit` |
| `mongoose.set("debug", true)` | `Typemo.instrument(...)` (operation events) |
| `$where`, `$function`, `$accumulator` | query operators, `$expr`, `fn.sum`, `fn.push`, `fn.top`, `fn.cond`, `fn.map`, `fn.reduce` |
| `mongoose.model("User", schema)` | `connection.model(User)` (a model belongs to a connection; no global model) |
| `schema.statics`, `schema.query` | plugin with `statics`; helper functions over the builder |
| `schema.methods`, `loadClass` | ordinary class methods (the class is the schema) |
| `schema.set/add/path/clone` | none: a schema is fixed after declaration; read it with `describe` |
| `toJSON` / `toObject` in schema options | per call: `doc.$toObject()`, `doc.$toPlain()`, `doc.$toJSON(options)` |
| `Model.populate(docs, paths)` | `.populate(...)` on the query, `doc.$populate(...)` on a document |
| `populate({ model })`, `forceRepopulate`, `options.options` | none: the model comes from the field; a second populate replaces the first |
| `doc.id` virtual | `_id` (`ObjectId`); a string only in plain output and `$toJSON()` |
| `doc.errors`, `invalidate`, `$isValid`, `modifiedPaths()`, `overwrite`, `equals`, `$clone` | validation throws `ValidationError`; compare with `$is`; changes via `$getChanges()` |
| `MongooseArray`, `$pop`, `nonAtomicPush`, `$atomics` | `StrictArray` methods: `push`, `pop`, `splice`, `set(i, v)`, `clear`, `replace` |
| `subdoc.deleteOne()` / `remove()` | `array.pull(subdoc)` on the parent array |
| `{ runValidators: true }`, `{ context: "query" }` | none: validation is always on (for `$set`, `$setOnInsert`, `$min`, `$max`, `$push`, `$addToSet`, `$inc` guarded by min/max) |
| `{ new: true }`, `{ returnOriginal }` | `returnDocument: "after"` (default) or `"before"` |
| `{ setDefaultsOnInsert }`, `{ timestamps: false }`, `{ omitUndefined }`, `{ overwriteDiscriminatorKey }` | none: core owns defaults/timestamps; `undefined` is an error; the discriminator key is immutable |
| `bufferCommands`, `bufferTimeoutMS` | client option `readyTimeoutMS`; operations before `connect()` wait inside the pipeline |
| `minimize`, `typeKey`, `id`, `skipVersioning`, `validateBeforeSave`, `validateModifiedOnly`, `selectPopulatedPaths`, schema `lean` | none |
| `_id: false` on a model | impossible; on a subdocument use `nested: true` |
| `OverwriteModelError` | none: `connection.model(Post)` twice returns the same model |
| `.setOptions`, `.getFilter`, `.getUpdate`, `.projection`, `.cast`, `.tailable`, `.slice`, `.error`, `.j`, `.w`, `.wtimeout`, `.$where` | none; intervene with a hook, or `client.unsafeDriver()` as a last resort (policies and checks do not apply there) |
| `connection.db`, `getClient()`, `Model.collection` | `client.unsafeDriver()` (the name says you leave the guarantees) |
| `connection.transaction(fn)`, `session.withTransaction` | `client.transaction(fn)`; the session is attached to model operations by itself |

## Examples

### Mixed

```ts
import { Entity, Prop, Schema, Spec } from "@venloc/typemo";

@Schema({ collection: "settings" })
class Settings extends Entity {
  // arbitrary string keys, values of one type, all validated
  @Prop(() => Spec.map(String)) preferences?: Map<string, string>;
}
```

When the keys are known, write a nested class instead of a map. Arbitrary JSON of unknown shape has no home in Typemo: store a string and parse it yourself, or keep that collection on the driver or on Mongoose (both can use one database, see the migration guide).

### Query hook without `this` as Query

```ts
import { type Defaulted, Entity, type OperationHookContext, Pre, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Boolean, { default: false }) archived!: Defaulted<boolean>;

  // Mongoose: schema.pre("find", function () { this.where({ archived: false }) })
  @Pre("query.find")
  onlyActive(this: OperationHookContext<Post, "query.find">): void {
    this.modify({ where: { archived: false } });
  }
}
```

The modified operation passes the policies again (tenant, soft delete, strict paths).

### Select and sort are objects

```ts
import { Entity, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number) views?: number;
}
declare const client: TypemoClient;
const Posts = client.connection.model(Post);

// Mongoose: .select("title -views").sort("-views title")
const posts = await Posts.find().select({ title: 1 }).sort({ views: -1, title: 1 });
```

Directions may also be `"asc"` / `"desc"`. Mixing inclusion and exclusion in one projection throws `QueryError`.

## Common mistakes

### Bad: a `Mixed` / `Object` field

```text
ConfigurationError: Settings.data: Object (Mixed) is not supported: declare a @Schema class or Spec.map(X)
```

Good: a nested class or `Spec.map(...)` as above.

### Bad: Mongoose-only schema options

```text
ConfigurationError: Order: @Schema has no "strict" option (the options are: collection, nested, ext, discriminatorKey, discriminators, timeseries, capped, collation, clustered, changeStreamPreAndPostImages, validator, autoIndex, autoCreate, readConcern, writeConcern, optimisticConcurrency, shardKey, tenant, softDelete, audit)
```

Good: delete the option. Typed code gets a compile error first; this message is for code that bypassed the types. `toJSON`/`toObject` are passed per call.

### Bad: JavaScript in a query or pipeline

```text
StrictModeError: "$where" runs JavaScript on the server and is not supported (at "filter.$where"): ...
```

Good: operators and `$expr`; in aggregation `fn.function` and `fn.accumulator` are compile errors, use `fn.sum`, `fn.push`, `fn.top`, `fn.cond`, `fn.map`, `fn.reduce`.

### Bad: expecting a plugin to mutate a schema late

```text
ConfigurationError: plugin "late": the global plugins are fixed once a schema is compiled (Account was); register plugins before the first model
```

Good: register plugins (and extensions, `client.use()`) before the first `connection.model(...)`.

### Bad: `Model.populate(docs, ...)` and `populate({ model })`

Good: `Posts.find().populate("author")` or `await doc.$populate("author")`. A path that is not a reference or embedded document is a `QueryError` (`populate "title": "title" is neither a reference nor an embedded document`).

## Self-check

- No string selects or sorts, no `next`, no `Mixed`, no `strict` options in the code you wrote.
- Cross-cutting behaviour (soft delete, tenant, audit) uses the built-in policies, not a hand-made plugin.
- Anything that needs `unsafeDriver()` has been shown to the user first.
