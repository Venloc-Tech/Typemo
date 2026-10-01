---
name: typemo-nestjs
description: Use when a NestJS application uses Typemo through `@venloc/typemo-nestjs`. Covers TypemoModule.forRoot / forRootAsync / forFeature, @InjectModel / @InjectConnection / @InjectClient, tokens, several clients and databases, sync at startup, views and materialized results, the @Transactional decorator (join), PolicyInterceptor and @AllTenants (tenant and actor from the request), TypemoExceptionFilter (error to HTTP status), ParseIdPipe, ValidateBodyPipe, and testing a Nest service with provideModelMock, provideClientMock and TypemoTestingModule from `@venloc/typemo-nestjs/testing`. Read together with the `typemo` skill, which describes the core API (entities, models, queries, errors).
---

# Typemo in NestJS (`@venloc/typemo-nestjs`)

The package wires the Typemo core into Nest 12 (ESM, Express adapter): the module creates, connects and closes the `TypemoClient`; models are injected by entity class; transactions are a method decorator; the tenant and actor come from the request; Typemo errors become HTTP answers. Everything about entities, models, queries and errors is the core API: also read `skills/typemo`.

## Task to file

| Task | Read |
|---|---|
| Install, `forRoot`, `forRootAsync`, `forFeature`, inject models/clients/connections, tokens, several clients or databases, `sync`, views | `references/01-module-and-models.md` |
| `@Transactional`, `join`, tenant and actor from the request, `@AllTenants` | `references/02-transactions-and-policies.md` |
| Error filter and status table, `ParseIdPipe`, `ValidateBodyPipe`, tests with mocks or a real database | `references/03-http-and-testing.md` |

## Core rules

1. Peer deps: `@nestjs/common` and `@nestjs/core` 12.1.2 or newer, `rxjs` 7, `reflect-metadata`, `mongodb`. Express only; GraphQL, microservices and Fastify are not supported by the filter and the interceptor.
2. `tsconfig`: `experimentalDecorators` and `emitDecoratorMetadata` on. Nest reads constructor parameter types from metadata.
3. Never turn the import of an injected class (service, controller dependency) into `import type`: the metadata then has no class, and Nest fails with `Nest can't resolve dependencies of the X (?)`. Turn off the lint rule that suggests it in Nest modules.
4. Import `TypemoModule.forRoot(...)` (or `forRootAsync`) once, in the root module. The client module is global.
5. List entities in `TypemoModule.forFeature([...])` of each feature module that injects them. Same entity in two modules is one model object.
6. Inject by class: `@InjectModel(Account) accounts: Model<Account>`. Never by a string name. You write the parameter type yourself, with the same entity as in the decorator (the compiler cannot check it).
7. The module writes nothing to the database at startup. Create collections and indexes with `sync: "init"` or `"sync"` in `forRoot`, or in your deploy step.
8. `@Transactional()` is for async methods on providers and controllers made by Nest. A nested `@Transactional()` call is an error; mark the inner method `@Transactional({ join: true })`.
9. A transactional method can run more than once (transient error retry): read inside the method and change numbers with `$inc`, not with arithmetic on a document loaded outside.
10. Tenant from the request: `app.useGlobalInterceptors(new PolicyInterceptor({ tenant: (req) => req.headers["x-tenant"] }))`. The resolver is synchronous. Cross-tenant routes use `@AllTenants()`.
11. Add `app.useGlobalFilters(new TypemoExceptionFilter())` to answer 409/422/400/404/503 instead of 500. Never write your own `try/catch` per handler for Typemo errors.
12. Check ids and bodies with `ParseIdPipe.for(Entity)` and `ValidateBodyPipe.for(Entity, options?)`; do not keep a DTO class in parallel with the entity.
13. The model token is a Symbol per (class, client, db). Override it in tests with `getModelToken(Account)` or use `provideModelMock`.
14. Transactions need a replica set (one node is enough). Test helpers: `@venloc/typemo-nestjs/testing` is a separate entry point, keep it out of application code.
15. The `name` of a client goes next to `useFactory` in `forRootAsync`, never in the object the factory returns.

## Minimal application

```ts
import { Injectable, Module } from "@nestjs/common";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, TypemoModule } from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

@Injectable()
class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  list() {
    return this.accounts.find().plain();
  }
}

@Module({
  imports: [TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank" }), TypemoModule.forFeature([Account])],
  providers: [AccountsService],
})
export class AppModule {}
```

## Self-check

- [ ] `forRoot` is imported once; every module that injects a model imports `forFeature` with that entity (and the same `{ client, db }` target as the `@InjectModel`).
- [ ] No injected class is imported with `import type`; `emitDecoratorMetadata` is on.
- [ ] Parameter types are `Model<Same entity as the decorator>`; views are `TypedView<Row>`, materialized are `Materialized<Row>`.
- [ ] Methods with `@Transactional` are `async`, run on a replica set, and are safe to run twice; inner ones use `join: true`.
- [ ] Multi-tenant app: `PolicyInterceptor` is registered, admin routes have `@AllTenants()`.
- [ ] `TypemoExceptionFilter` is registered; handlers do not map Typemo errors by hand.
- [ ] `sync` is chosen on purpose (`false` by default).
- [ ] Tests: unit tests use `provideModelMock` (+ `...provideClientMock()` and `await moduleRef.init()` for `@Transactional`); database tests use `TypemoTestingModule.forRoot` and `clear` in `afterEach`.
