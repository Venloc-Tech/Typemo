# HTTP errors, pipes and testing in Nest

Read this for `TypemoExceptionFilter`, `ParseIdPipe`, `ValidateBodyPipe`, and for tests of Nest services (`@venloc/typemo-nestjs/testing`).

## Minimal working example

```ts
import { Body, Controller, Get, Injectable, Module, Param, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type CreateInput, Entity, type IdOf, type Model, Prop, Schema } from "@venloc/typemo";
import {
  InjectModel,
  ParseIdPipe,
  TypemoExceptionFilter,
  TypemoModule,
  ValidateBodyPipe,
} from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}

@Injectable()
class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  async open(body: CreateInput<Account>) {
    return (await this.accounts.create(body)).$toPlain();
  }

  get(id: IdOf<Account>) {
    return this.accounts.findById(id).orFail().plain();
  }
}

@Controller("accounts")
class AccountsController {
  constructor(private readonly service: AccountsService) {}

  @Post()
  open(@Body(ValidateBodyPipe.for(Account)) body: CreateInput<Account>) {
    return this.service.open(body);
  }

  @Get(":id")
  get(@Param("id", ParseIdPipe.for(Account)) id: IdOf<Account>) {
    return this.service.get(id);
  }
}

@Module({
  imports: [TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank" }), TypemoModule.forFeature([Account])],
  controllers: [AccountsController],
  providers: [AccountsService],
})
class AppModule {}

const app = await NestFactory.create(AppModule);
app.useGlobalFilters(new TypemoExceptionFilter());
```

`ParseIdPipe.for(Entity)` and `ValidateBodyPipe.for(Entity)` return a pipe **class**; Nest injects the entity model from the `forFeature` of the controller's module. So the controller's module must import `forFeature` with that entity (and the same `target` if you pass one).

## TypemoExceptionFilter

Turns Typemo errors and raw driver errors (`MongoError`, e.g. from `client.unsafeDriver()`) into HTTP answers. The kind comes from `ErrorClassifier.classify`. The answer never contains server text, addresses or stored values; for a duplicate key it lists field names only. It does not touch Nest's own `HttpException` or your own errors. HTTP (Express) context only; elsewhere it rethrows.

Register: `app.useGlobalFilters(new TypemoExceptionFilter())`. The body looks like Nest's: `statusCode`, `error`, `message` plus the fields of the kind.

| Kind | Status | Body |
|---|---|---|
| `duplicate-key` (and a duplicate `_id` from the raw driver) | 409 | `{ message: "Duplicate value", fields: ["email"] }` |
| `validation` | 422 | `{ message: "Validation failed", errors: { age: "must be at most 150" } }` |
| `server-validation` | 422 | `{ message: "Validation failed" }` |
| `cast` | 400 | `{ message: "Invalid value", path: "age" }` |
| `strict` | 400 | `{ message: "Not allowed", reason: "unknown-path", path: "filter.nickname" }` (a missing tenant: `reason: "tenant"`) |
| `not-found` (`orFail`) | 404 | `{ message: "Not found" }` |
| `version`, `write-conflict` | 409 | `{ message: "The document was changed by someone else" }` |
| `timeout` | 504 | `{ message: "The database took too long" }` |
| `connection` | 503 | `{ message: "The database is unavailable" }` |
| other with the `TransientTransactionError` label | 503 | `{ message: "Try again" }` |
| `bulk-write` with a duplicate | 409 | `{ message: "Duplicate value" }` |
| anything else, including `post-hook` | 500 | `{ message: "Internal server error" }` |

500 answers are logged (`Logger("TypemoExceptionFilter")`) with the error text; a `PostHookError` is marked `(the write was applied)`: the write stayed, the hook after it failed.

Change one answer by overriding `toResponse(error, classification)` (returns `{ status, body }`, type `TypemoHttpResponse`) and call `super.toResponse` for the rest:

```ts
import type { ErrorClassification } from "@venloc/typemo";
import { TypemoExceptionFilter, type TypemoHttpResponse } from "@venloc/typemo-nestjs";

export class ApiExceptionFilter extends TypemoExceptionFilter {
  override toResponse(error: unknown, classification: ErrorClassification): TypemoHttpResponse {
    if (classification.kind === "not-found") return { status: 404, body: { code: "NOT_FOUND" } };
    return super.toResponse(error, classification);
  }
}
```

## ParseIdPipe

Turns the route parameter (always a string) into the `_id` of the entity: `ObjectId` (24 hex characters), `UUID`, string, number. A wrong id is a 400 with a clear text, not a cast error deep in the request. For a numeric `_id` the pipe parses digits strictly (`"42"` gives `42`; `"42abc"` and `"1e3"` are 400), because the core never casts `"5"` to a number.

```ts
import { Controller, Delete, Get, Param } from "@nestjs/common";
import { Entity, type IdOf, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, ParseIdPipe } from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}

@Controller("accounts")
export class AccountsController {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  @Get(":id")
  get(@Param("id", ParseIdPipe.for(Account)) id: IdOf<Account>) {
    return this.accounts.findById(id).orFail().plain();
  }

  @Delete(":id")
  remove(@Param("id", ParseIdPipe.for(Account, { db: "archive" })) id: IdOf<Account>) {
    return this.accounts.deleteOne({ _id: id });
  }
}
```

Texts of the 400 answer (the route parameter name stands in place of `id`):

```text
Invalid id: expected ObjectId (not a 24-character hex string)
Invalid id: expected number (expected a number)
```

Signature: `ParseIdPipe.for(entity, target?)`; with a model in hand: `new ParseIdPipe(model).transform(value)`.

## ValidateBodyPipe

Checks the request body with the entity schema (`Model.validate`): field types, `required`, `min`/`max`, `enum`, lengths, validators, with no separate DTO. All errors come at once: 422 with a message per field. The result is the cast fields that were sent, without defaults (`create` adds them). It does not cast strings to numbers: `"30"` for a number field is 422.

Signature: `ValidateBodyPipe.for(entity, options?, target?)`; with a model: `new ValidateBodyPipe(model, options)`.

| Option | Default | Meaning |
|---|---|---|
| `pick` | none | only these fields may be sent; others are `"not allowed here"` |
| `omit` | none | these fields may not be sent (role, owner set by the server); `pick` together with `omit` is an error |
| `partial` | `false` | for updates: only sent fields are checked, a required field may be absent; `_id`, immutable fields and core-managed fields (`createdAt`, `updatedAt`) are rejected with `"cannot be changed"`; result type is `UpdateInput<T>` |
| `dropUnknown` | `false` | drop unknown fields and those excluded by `pick`/`omit`/`partial` instead of answering 422 |

An unknown field is 422 by default (a typo `balanse` never disappears silently). A body that is not an object is 422 with the key `""`. The value of a `sensitive` field never appears in the answer.

```ts
import { Body, Controller, Param, Patch, Post } from "@nestjs/common";
import { type CreateInput, Entity, type IdOf, type Model, Prop, Schema, type UpdateInput } from "@venloc/typemo";
import { InjectModel, ParseIdPipe, ValidateBodyPipe } from "@venloc/typemo-nestjs";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true, minLength: 2 }) name!: string;
  @Prop(() => Number, { required: true, max: 150 }) age!: number;
  @Prop(() => String, { enum: ["user", "admin"] as const }) role?: "user" | "admin";
}

@Controller("users")
export class UsersController {
  constructor(@InjectModel(User) private readonly users: Model<User>) {}

  @Post()
  async create(@Body(ValidateBodyPipe.for(User, { omit: ["role"] })) body: CreateInput<User>) {
    return (await this.users.create(body)).$toPlain();
  }

  @Patch(":id")
  async update(
    @Param("id", ParseIdPipe.for(User)) id: IdOf<User>,
    @Body(ValidateBodyPipe.for(User, { partial: true })) body: UpdateInput<User>,
  ) {
    return this.users.findOneAndUpdate({ _id: id }, { $set: body }, { returnDocument: "after" }).orFail().plain();
  }
}
```

A 422 answer for `{ email: "bob@x.io", name: "B", age: 200, role: "root" }` has `statusCode: 422`, `error: "Unprocessable Entity"`, `message: "Validation failed"` and `errors` with one text per field: `name: "must be at least 2 characters long"`, `age: "must be at most 150"`, `role: "must be one of \"user\", \"admin\""`.

Invalid options throw when the pipe is created: `ConfigurationError: ValidateBodyPipe: give pick or omit, not both`, `ConfigurationError: ValidateBodyPipe: unknown option "strip" (known: pick, omit, partial, dropUnknown)`.

## Testing: `@venloc/typemo-nestjs/testing`

A separate entry point so that test helpers stay out of application code. Examples use `bun:test`; Jest and Vitest are the same.

### Unit test with a model mock (no database)

`provideModelMock(Entity, mock, target?)` registers a provider under the model token. The mock keeps the names and parameters of the model methods (`ModelMock<M>`): a typo in a method name or wrong arguments is a compile error (TS2353 for an unknown name). A method missing in the mock is `undefined`, so a forgotten call fails with `TypeError` instead of returning something plausible. For a view give the mock type as the second type parameter: `provideModelMock<typeof FundedAccount, TypedView<FundedAccount>>(FundedAccount, {...})`.

```ts
import { expect, test } from "bun:test";
import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel } from "@venloc/typemo-nestjs";
import { provideModelMock } from "@venloc/typemo-nestjs/testing";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}

@Injectable()
class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  countFunded() {
    return this.accounts.countDocuments({ balance: { $gt: 0 } });
  }
}

test("counts funded accounts", async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [AccountsService, provideModelMock(Account, { countDocuments: async () => 3 })],
  }).compile();
  expect(await moduleRef.get(AccountsService).countFunded()).toBe(3);
});
```

### Unit test of a `@Transactional` service

`...provideClientMock(mock?, name?)` (spread into `providers`) adds a client mock whose `transaction(fn)` calls `fn` at once and returns its result, and binds `@Transactional` to it. Call `await moduleRef.init()`: the decorator is bound at module init.

```ts
import { expect, test } from "bun:test";
import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, Transactional } from "@venloc/typemo-nestjs";
import { provideClientMock, provideModelMock } from "@venloc/typemo-nestjs/testing";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}

@Injectable()
class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  @Transactional()
  async openPair(title: string): Promise<number> {
    await this.accounts.create({ title });
    return this.accounts.countDocuments({ title });
  }
}

test("opens a pair in a transaction", async () => {
  const calls: string[] = [];
  const moduleRef = await Test.createTestingModule({
    providers: [
      AccountsService,
      provideModelMock(Account, { create: async () => ({}), countDocuments: async () => 2 }),
      ...provideClientMock({
        transaction: async (fn: (scope: never) => Promise<unknown>) => {
          calls.push("transaction");
          return fn(undefined as never);
        },
      }),
    ],
  }).compile();
  await moduleRef.init();
  expect(await moduleRef.get(AccountsService).openPair("Main")).toBe(2);
  expect(calls).toEqual(["transaction"]);
});
```

### Test on a real database

`TypemoTestingModule.forRoot(uri, options?)` is `TypemoModule.forRoot` for tests: its own database per call (`typemo_test_<time>_<n>` unless `dbName` is given), `sync: "init"` (collections exist before the first test, so a transaction does not collide with a collection creation) and one connection attempt. Any option can be overridden. `TypemoTestingModule.clear(moduleRef, name?)` deletes the documents of every `forFeature` model of the client through the models (`Filters.all()`: all tenants, soft-deleted included; views skipped): call it in `afterEach`. The test database stays on the server after `close()`: drop the test server or the database by name.

```ts
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Injectable } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, Transactional, TypemoModule } from "@venloc/typemo-nestjs";
import { TypemoTestingModule } from "@venloc/typemo-nestjs/testing";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}

@Injectable()
class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  @Transactional()
  async openPair(title: string): Promise<number> {
    await this.accounts.create({ title, balance: 1 });
    await this.accounts.create({ title, balance: 2 });
    return this.accounts.countDocuments({ title });
  }
}

let moduleRef: TestingModule;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [TypemoTestingModule.forRoot(process.env.MONGO_URI ?? ""), TypemoModule.forFeature([Account])],
    providers: [AccountsService],
  }).compile();
  await moduleRef.init();
});
afterEach(() => TypemoTestingModule.clear(moduleRef));
afterAll(() => moduleRef.close());

test("opens a pair", async () => {
  expect(await moduleRef.get(AccountsService).openPair("Main")).toBe(2);
});
```

### e2e test of HTTP

Build the app from the testing module on a free port and call it with `fetch`; register filters, interceptors and pipes exactly as in `main.ts` (`app = moduleRef.createNestApplication(); app.useGlobalFilters(new TypemoExceptionFilter()); await app.listen(0, "127.0.0.1")`, then read the port from `app.getHttpServer().address()`). `afterAll(() => app.close())`. Assert statuses and bodies: `GET /accounts/not-an-id` is 400.

Mock or database? A bug that can live in the service logic (condition, calculation, call order) is found faster with a mock; a bug in the talk to the database (wrong filter, unused index, transaction not rolling back, tenant not applied) only a real server shows.

## Common mistakes

Bad: `@Transactional` in a unit test fails with `called on an object no Nest application with TypemoModule has registered`. Good: `...provideClientMock()` in `providers` and `await moduleRef.init()`.

Bad: tests see each other's data (one module per file, shared database, no cleanup). Good: `TypemoTestingModule.clear(moduleRef)` in `afterEach`, or a module per test.

Bad: the mock does not replace the model because the service injects another target: `@InjectModel(Account, { db: "archive" })` against `provideModelMock(Account, mock)`. Good: pass the same target as the third argument.

Bad: `ParseIdPipe.for(Account)` in a controller whose module lacks `forFeature([Account])`: Nest cannot resolve the model token. Good: import `forFeature` there.

Bad: the filter or the interceptor on GraphQL, microservices or Fastify (HTTP Express only). Good: map errors with `ErrorClassifier.classify` and open `PolicyContext.run` yourself.

## Self-check

- [ ] `TypemoExceptionFilter` is registered globally in `main.ts` and in the e2e test app.
- [ ] Every `ParseIdPipe.for` / `ValidateBodyPipe.for` entity is in the `forFeature` of the controller's module.
- [ ] Update endpoints use `{ partial: true }`; server-owned fields are in `omit`.
- [ ] Unit tests: `provideModelMock` (+ `...provideClientMock()` and `init()` for `@Transactional`).
- [ ] Database tests: `TypemoTestingModule.forRoot` on a replica set, `clear` in `afterEach`, `close()` in `afterAll`.
