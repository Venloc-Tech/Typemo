# @venloc/typemo-nestjs

**The NestJS module of [`@venloc/typemo`](https://www.npmjs.com/package/@venloc/typemo).** Typed models in Nest's dependency injection, injected by class (no string tokens, no hand-written model types), the client's lifecycle tied to the application, transactions as a method decorator, the tenant of the request applied to every query, database errors mapped to HTTP answers, and helpers for unit and e2e tests. It replaces `@nestjs/mongoose` (it does not depend on Mongoose).

```bash
bun add @venloc/typemo @venloc/typemo-nestjs mongodb
```

## Setup

```ts
import { Injectable, Module } from "@nestjs/common";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, TypemoModule } from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

@Injectable()
export class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  rich() {
    return this.accounts.find({ balance: { $gt: 100 } }).lean();
  }
}

@Module({
  imports: [
    TypemoModule.forRoot("mongodb://localhost:27017/app?replicaSet=rs0", { sync: "init" }),
    TypemoModule.forFeature([Account]),
  ],
  providers: [AccountsService],
})
export class AppModule {}
```

## What it gives you

- **`TypemoModule.forRoot` / `forRootAsync`** — creates and connects a `TypemoClient` (with retries, a lazy mode, `onClientCreate` for extensions and instrumentation), closes it on shutdown, several named clients, optional `sync` of collections and indexes at start.
- **`TypemoModule.forFeature([...])`** — models by class, on a client and database of your choice (`{ client, db }`); discriminators, models with any `_id` type, plugin statics, views and materialized results.
- **`@InjectModel(Entity)`, `@InjectConnection()`, `@InjectClient()`**.
- **`@Transactional()`** — a method runs in a transaction of the client; `@Transactional({ join: true })` joins an open one when called from another transactional method.
- **`PolicyInterceptor` and `@AllTenants()`** — the tenant (and the audit actor) of the request applies to everything the handler calls.
- **`TypemoExceptionFilter`** — Typemo errors become HTTP answers (duplicate key 409, validation 422, bad input 400, not found 404, conflict 409, timeout 504, …) without leaking the server's text or sensitive values; override `toResponse` to change the shape.
- **`ParseIdPipe.for(Entity)`** — a route parameter becomes the model's `_id` type (ObjectId, UUID, number or string); **`ValidateBodyPipe.for(Entity, { pick, omit, partial, dropUnknown })`** — the request body is validated by the schema itself, no DTO class.
- **`@venloc/typemo-nestjs/testing`** — `provideModelMock` (method names and parameters checked against the real model), `provideClientMock`, `TypemoTestingModule` for tests on a real database.

## Requirements

NestJS 12 (ESM), `@venloc/typemo` 1.x, `mongodb` 7.6, `rxjs` 7 and `reflect-metadata` (for Nest's own DI) as peer dependencies. Keep Nest imports of injected classes as value imports (not `import type`): Nest reads their metadata.

## For AI coding agents

This package ships an agent skill in `skills/typemo-nestjs/`; it builds on the core skill in `@venloc/typemo/skills/typemo/`.

## Links

- Repository and issues: https://github.com/Venloc-Tech/typemo
- License: MIT
