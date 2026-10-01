# Module, models, injection (`@venloc/typemo-nestjs`)

Read this to wire Typemo into a Nest 12 application: the root module, feature modules, injection, several clients and databases, `sync`, views and materialized results.

```bash
bun add @venloc/typemo @venloc/typemo-nestjs mongodb @nestjs/common @nestjs/core @nestjs/platform-express rxjs reflect-metadata
```

```json
{ "compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true, "strict": true } }
```

Never convert the import of an injected class to `import type`: Nest reads the class from the emitted metadata. Without it: `Nest can't resolve dependencies of the AccountsController (?)`.

## Minimal working example

```ts
import { Controller, Get, Injectable, Module } from "@nestjs/common";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, TypemoModule } from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true, min: 0 })
  balance!: number;
}

@Injectable()
export class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  list() {
    return this.accounts.find().plain();
  }
}

@Controller("accounts")
export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  @Get()
  list() {
    return this.service.list();
  }
}

@Module({
  imports: [TypemoModule.forFeature([Account])],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}

@Module({
  imports: [TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank" }), AccountsModule],
})
export class AppModule {}
```

- `forRoot` creates the `TypemoClient`, connects at startup (the app does not start until connected), closes at shutdown. For closing on process signals call `app.enableShutdownHooks()`. The client module is global: import `forRoot` once.
- `forFeature` registers models of the importing module; it does not touch the database.
- A model is the core `connection.model(Entity)`: the same entity in two modules is the same object.

## forRoot and its options

`TypemoModule.forRoot(uri: string, options?: TypemoModuleOptions): DynamicModule`. Options are all `TypemoClientOptions` of the core (`name`, `dbName`, `readyTimeoutMS`, driver options such as `maxPoolSize`) plus:

| Option | Default | Meaning |
|---|---|---|
| `retryAttempts` | `9` | Attempts before startup fails; `0` and `1` mean one attempt. Only retryable errors repeat (no server, network); a wrong password stops at once. |
| `retryDelay` | `3000` | Pause between attempts, ms. |
| `lazyConnection` | `false` | `true`: start without waiting; operations before the connection wait up to `readyTimeoutMS`, then throw `ConnectionError`. |
| `sync` | `false` | `false`, `"init"` (`connection.init()`: creates missing collections, indexes, views) or `"sync"` (`connection.syncAll()`: also replaces a differently declared index). Runs in `onApplicationBootstrap` for each database that has `forFeature` models; failure is `SyncError` and stops startup. |
| `onClientCreate` | none | `(client) => void \| Promise<void>`: called once with the new client before connecting and before any model. Put `client.use(...)`, plugins and `client.instrument(...)` here: extensions are sealed by the first model compile. Also called with `lazyConnection`. |
| `clientFactory` | none | `(client) => TypemoClient \| Promise<TypemoClient>`: returns the client providers receive (normally the same one). |
| `clientErrorFactory` | none | `(error) => Error`: the error startup fails with. |

Example: `TypemoModule.forRoot("mongodb://db:27017/?serverSelectionTimeoutMS=2000", { dbName: "bank", retryAttempts: 5, retryDelay: 1000, sync: "init", onClientCreate: (client) => { /* client.use(...), client.instrument(...) */ } })`.

One attempt lasts up to the driver `serverSelectionTimeoutMS` (30 s by default), so 9 attempts can take minutes: lower both for a fast failure. Logs go to the Nest `Logger("TypemoModule")` and never contain the connection string.

Choose `sync`: if a deploy or migration step owns the schema, keep `false` and call `connection.init()` / `syncAll()` there; with no such step (dev, tests, a small app) `"init"` is safe because it only adds; use `"sync"` only if the app is the single owner of the schema.

## forRootAsync

Exactly one source of options: `useFactory` (+ `inject`), `useClass`, or `useExisting`. The client `name` is next to the source, never inside the factory result (type `name?: never`).

```ts
import { Injectable, Module } from "@nestjs/common";
import {
  TypemoModule,
  type TypemoModuleFactoryOptions,
  type TypemoOptionsFactory,
} from "@venloc/typemo-nestjs";

@Injectable()
class Config {
  readonly mongoUri = "mongodb://localhost:27017";
}
@Module({ providers: [Config], exports: [Config] })
class ConfigModule {}

// 1. factory: annotate the parameters, the module does not know what `inject` lists
const fromFactory = TypemoModule.forRootAsync({
  name: "main",
  imports: [ConfigModule],
  inject: [Config],
  useFactory: (config: Config): TypemoModuleFactoryOptions => ({ uri: config.mongoUri, dbName: "bank" }),
});

// 2. class: the module creates it and injects its dependencies
@Injectable()
class DatabaseConfig implements TypemoOptionsFactory {
  constructor(private readonly config: Config) {}

  createTypemoOptions(): TypemoModuleFactoryOptions {
    return { uri: this.config.mongoUri, dbName: "bank" };
  }
}
const fromClass = TypemoModule.forRootAsync({ imports: [ConfigModule], useClass: DatabaseConfig });

// 3. existing: the class is already provided by a module from `imports`
const fromExisting = TypemoModule.forRootAsync({ imports: [ConfigModule], useExisting: DatabaseConfig });

export const modules = [fromFactory, fromClass, fromExisting];
```

`TypemoModuleFactoryOptions` is `uri` (required) plus client options without `name` plus the module options above.

## Inject models, connections, clients

| Decorator | Injects |
|---|---|
| `@InjectModel(Entity, target?)` | the model of an entity registered in `forFeature` with the same `target` (`TypedView` for views, `Materialized` for materialized results) |
| `@InjectConnection(target?)` | the `Connection` of the default database or of `target.db` (for `connection.aggregate`, `connection.init`) |
| `@InjectClient(name?)` | the `TypemoClient` named `name` (`"default"` without a name): `client.transaction`, `client.state` |

```ts
import { Controller, Get, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { type Connection, Entity, type Model, Prop, Schema, type TypemoClient } from "@venloc/typemo";
import { InjectClient, InjectConnection, InjectModel } from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Account) private readonly accounts: Model<Account>,
    @InjectModel(Account, { db: "archive" }) private readonly archived: Model<Account>,
    @InjectConnection({ db: "archive" }) private readonly archive: Connection,
  ) {}
}

@Controller("health")
export class HealthController {
  constructor(@InjectClient() private readonly client: TypemoClient) {}

  @Get()
  check() {
    if (this.client.state !== "connected") throw new ServiceUnavailableException({ database: this.client.state });
    return { database: "connected" };
  }
}
```

The parameter type is yours: a parameter decorator cannot check it, so `@InjectModel(Account) orders: Model<Order>` compiles. Write `Model<>` of the same entity as in the decorator. `InjectModel("Account")` (a string) is a compile error (TS2345).

## Several databases and clients

`forFeature(features, { client?, db? })`: `db` selects another database of the same client (shared pool; a client transaction covers both); `client` selects another client by its `forRoot` name. The target is part of the token: `@InjectModel(Account)` and `@InjectModel(Account, { db: "archive" })` are different models.

```ts
import { Injectable, Module } from "@nestjs/common";
import { Entity, type Model, Prop, Schema, type TypemoClient } from "@venloc/typemo";
import { InjectClient, InjectModel, TypemoModule } from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

@Injectable()
export class SplitService {
  constructor(
    @InjectModel(Account) private readonly main: Model<Account>,
    @InjectModel(Account, { client: "analytics" }) private readonly copies: Model<Account>,
    @InjectClient("analytics") private readonly analytics: TypemoClient,
  ) {}
}

@Module({
  imports: [TypemoModule.forFeature([Account]), TypemoModule.forFeature([Account], { client: "analytics" })],
  providers: [SplitService],
})
class SplitModule {}

@Module({
  imports: [
    TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank" }),
    TypemoModule.forRoot("mongodb://analytics:27017", { name: "analytics", dbName: "analytics", lazyConnection: true }),
    SplitModule,
  ],
})
export class AppModule {}
```

Two `forRoot` with the same name: `ConfigurationError: TypemoModule.forRoot: two clients named "default" in one application; give each forRoot its own name`.

## Tokens

- `getModelToken(Entity, target?)`: a **symbol** made once per class and target (`TypemoModel:Account#1 (client "default", db "archive")`), so two classes named `Account` never share a token.
- `getConnectionToken(target?)`: the string `"TypemoConnection:<client>/"` (default database) or `"TypemoConnection:<client>/<db>"`.
- `getClientToken(name?)`: the string `"TypemoClient:<name>"`; the name is a non-empty string without `/`.

Use them for `overrideProvider(getModelToken(Account))` and `moduleRef.get`.

## forFeature entries

An entry is an entity class, `{ entity, statics }`, `TypemoModule.view(...)` or `TypemoModule.materialized(...)`. The collection name is not an option here; it belongs to the entity (`@Schema({ collection })`).

```ts
import { Injectable, Module } from "@nestjs/common";
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  EntityWithId,
  fn,
  type Materialized,
  type Model,
  Prop,
  Schema,
  type TypedView,
} from "@venloc/typemo";
import { InjectModel, TypemoModule } from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
class Account extends Entity {
  declare readonly __t?: DiscriminatorValue<"savings">;
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}

@Discriminator("savings")
class SavingsAccount extends Account {
  declare readonly __t: DiscriminatorValue<"savings">;
  @Prop(() => Number, { required: true }) rate!: number;
}

@Schema({ collection: "funded_accounts" })
class FundedAccount extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const funded = TypemoModule.view(FundedAccount, {
  on: Account,
  pipeline: (p) => p.match({ balance: { $gt: 0 } }).project({ title: 1, balance: 1 }),
});

@Schema({ collection: "title_totals" })
class TitleTotal extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true }) total!: number;
}
const totals = TypemoModule.materialized(TitleTotal, {
  from: Account,
  pipeline: (p) => p.group((f) => ({ _id: f.title, total: fn.sum(f.balance) })),
  mode: "replace",
});

@Injectable()
export class AccountsService {
  constructor(
    @InjectModel(Account) private readonly accounts: Model<Account>,
    @InjectModel(SavingsAccount) private readonly savings: Model<SavingsAccount>,
    @InjectModel(FundedAccount) private readonly funded: TypedView<FundedAccount>,
    @InjectModel(TitleTotal) private readonly totals: Materialized<TitleTotal>,
  ) {}

  async rebuild() {
    await this.totals.refresh();
    return this.totals.model.find({}).lean();
  }
}

@Module({
  imports: [TypemoModule.forFeature([Account, SavingsAccount, funded, totals])],
  providers: [AccountsService],
})
export class AccountsModule {}
```

- Discriminators: list them in any order; the core compiles the base in the same collection. If only the child is listed there is no provider for the base: list the base to inject it.
- Views: only reads (`TypedView`). The view is created by `sync` (`"init"` or `"sync"`); until then a read throws `ConfigurationError` instead of returning an empty list. A pipeline that does not produce the row fields is a compile error (TS2322).
- Materialized: `refresh()` recomputes; nothing runs on a schedule by itself. `mode`, `on`, `whenMatched`, `whenNotMatched` are as in `Materialized.define`.
- A class is a model or a view on a database, not both (`... is registered as a view and as a model ...; a class is one of them`).

### Plugin statics

`{ entity, statics }` injects a model with `Model.statics(plugin)` applied: the plugin must already be applied to the entity (`@Plugin`, client plugin or global), else startup fails with `ConfigurationError: Note: plugin "count" is not applied to this model's schema`. Type the parameter yourself: `Model<Note> & PluginStatics<typeof countPlugin>`.

## Common mistakes

Bad: the module that declares the service does not import `forFeature`.
```text
Nest can't resolve dependencies of the AccountsService (?). Please make sure that the argument Symbol(TypemoModel:Account#1 (client "default")) at index [0] is available in the AccountsModule module.
```
Good: `imports: [TypemoModule.forFeature([Account])]` in that module (same `{ client, db }` as the `@InjectModel`).

Bad: `forFeature` without a `forRoot` (or with another client name).
```text
Nest can't resolve dependencies of the Symbol(TypemoModel:Account#1 (client "default")) (?, TypemoRegistry:default). Please make sure that the argument "TypemoClient:default" at index [0] is available in the TypemoModule module.
```
Good: `TypemoModule.forRoot(...)` in the root module; `forFeature([Account], { client: "main" })` for `forRoot(uri, { name: "main" })`.

Bad: the same entity listed twice, or an unknown key.
```text
ConfigurationError: TypemoModule.forFeature: Account is listed twice
ConfigurationError: TypemoModule.forFeature: unknown key "collection" in { entity: Account } (known: entity, statics)
```
Good: one entry per class; give `statics` to that entry; the collection is set on the entity.

Bad: a class without `@Schema` in `forFeature`: `ConfigurationError: NotASchema: not a schema; decorate the class with @Schema()`. Good: decorate it (a `@Discriminator` child does not need `@Schema`).

Bad: `name` in the `forRootAsync` factory result (compile error TS2322; if the type is bypassed: `ConfigurationError: TypemoModule.forRootAsync (useFactory): the result has "name"; name the client next to useFactory: forRootAsync({ name, useFactory })`). Good: `forRootAsync({ name, useFactory })`.

Bad: `forRootAsync` with none of `useFactory`, `useClass`, `useExisting`: `ConfigurationError: TypemoModule.forRootAsync: give one of useFactory, useClass, useExisting (got none)`. An empty URI: `ConfigurationError: TypemoModule.forRoot: the connection string is a non-empty string`. Bad `sync`: `TypemoModule.forRoot: sync is false, "init" or "sync", got "all"`.

Bad: `client.use(...)` in a service or `onModuleInit`: models are already compiled and the extension is not applied. Good: do it in `onClientCreate`.

Bad: a startup that fails after minutes because of 9 attempts times 30 s. Good: lower `retryAttempts` and add `?serverSelectionTimeoutMS=2000` to the URI.

## Self-check

- [ ] One `forRoot`; every injecting module has `forFeature` with the same target.
- [ ] No `import type` on injected classes; `emitDecoratorMetadata` is on.
- [ ] Multiple clients: unique `name` per `forRoot`; `{ client }` on `forFeature`, `@InjectModel`, `@InjectClient`.
- [ ] `sync` is a conscious choice; views need `sync` or a deploy step before the first read.
- [ ] `onClientCreate` holds `client.use` / `client.instrument`.
