# Transactions and policies in Nest

Read this for `@Transactional` (including `join`), `PolicyInterceptor` (tenant and actor from the request) and `@AllTenants`. In Typemo a transaction and the policy context are not passed as parameters: an operation finds the transaction and the tenant of the current async call by itself.

Transactions need MongoDB as a replica set (one node is enough). On a standalone `mongod` the core rejects the transaction before writing.

## Minimal working example

```ts
import { Injectable, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, PolicyInterceptor, Transactional, TypemoModule } from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}

@Injectable()
export class TransfersService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  @Transactional()
  async transfer(from: Account["_id"], to: Account["_id"], amount: number): Promise<void> {
    await this.accounts.updateOne({ _id: from }, { $inc: { balance: -amount } });
    await this.accounts.updateOne({ _id: to }, { $inc: { balance: amount } });
  }
}

@Module({
  imports: [TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank" }), TypemoModule.forFeature([Account])],
  providers: [TransfersService],
})
class AppModule {}

const app = await NestFactory.create(AppModule);
app.useGlobalInterceptors(new PolicyInterceptor({ tenant: (request) => request.headers["x-tenant"] }));
```

## @Transactional

`@Transactional(options?)` runs the method in `client.transaction`: every Typemo operation inside it, and inside the methods it calls, joins the transaction without a session parameter. It commits when the returned promise resolves and rolls back when it rejects; the error reaches the caller unchanged.

- The method must be `async` (returns a promise). A synchronous method is a compile error.
- It works on instance methods of providers and controllers. At startup the application binds every provider and controller that has such methods to its clients (request-scoped classes through the prototype). After shutdown the binding is removed.
- On a controller handler it works in any order with `@Post()`: route metadata moves to the wrapper. A handler that creates a document and then throws returns 500 and leaves nothing.
- Models of two databases of one client (`forFeature(..., { db })`) share the one transaction.
- The method can run **several times**: a transient error (`TransientTransactionError`) retries the whole transaction. So read documents inside the method and change numbers atomically (`$inc`). A document loaded before the call and changed by arithmetic inside (`account.balance -= 10`) would be applied twice on a retry.

Options (`TransactionalOptions`):

| Option | Default | Meaning |
|---|---|---|
| `client` | `"default"` | the client whose transaction it is (name from `forRoot`) |
| `join` | `false` | join an open transaction of the same client (see below) |
| `readConcern`, `writeConcern`, `timeoutMS`, `maxCommitTimeMS` | core defaults | transaction options of the core; not allowed with `join: true` |

```ts
import { Injectable } from "@nestjs/common";
import { Transactional } from "@venloc/typemo-nestjs";

@Injectable()
export class BillingService {
  // the transaction of the client named "billing"; options are the core transaction options
  @Transactional({ client: "billing", timeoutMS: 5000, readConcern: "snapshot" })
  async charge(): Promise<void> {}
}
```

When only a part of a method must be transactional (read, write atomically, send an e-mail outside), inject the client with `@InjectClient()` and call `client.transaction(...)` around that part. When the whole method is transactional, use the decorator: the boundary is visible in the declaration. One write is atomic by itself; a transaction around a single `updateOne` adds nothing.

## Nested calls: join

MongoDB has no nested transactions. A decorated method called from another decorated method is an error unless the inner one has `join: true`: inside an open transaction of the same client it runs in it (no commit or rollback of its own; its error goes out and rolls back the outer transaction), outside it opens its own.

```ts
import { Injectable } from "@nestjs/common";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, Transactional } from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}

@Injectable()
export class LedgerService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  @Transactional({ join: true })
  async entry(title: string): Promise<void> {
    await this.accounts.create({ title, balance: 1 });
  }

  @Transactional()
  async pair(title: string): Promise<number> {
    await this.entry(title);
    await this.entry(title);
    return this.accounts.countDocuments({ title });
  }
}
```

`pair` runs both `entry` calls in one transaction and returns 2; `entry` called alone opens its own. An error in the second `entry` leaves no record from `pair`. On a transient error the whole outer transaction repeats, and the joined method runs again with it.

Inside a transaction of **another** client, `join` throws instead of silently opening a second transaction (a write in the other client would not roll back with the outer one).

Rule of thumb: every method that can be called both alone and from another transactional method gets `join: true`.

## PolicyInterceptor: tenant and actor from the request

`PolicyInterceptor` runs every HTTP handler inside `PolicyContext.run` with values from the request. Services know nothing about the tenant: `orders.find()` gets the tenant filter, `orders.create` sets the tenant field. The context lives through the whole async chain (after `await`, in the `Observable` the handler returns).

```ts
import { Controller, Get, Module, Post, Body } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Entity, type Model, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";
import { InjectModel, PolicyInterceptor, TypemoModule } from "@venloc/typemo-nestjs";

@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}

@Controller("orders")
class OrdersController {
  constructor(@InjectModel(Order) private readonly orders: Model<Order>) {}

  @Post()
  async create(@Body() body: { readonly number: string }) {
    return (await this.orders.create({ number: body.number })).$toPlain();
  }

  @Get()
  async list() {
    return (await this.orders.find().sort({ number: 1 }).plain()).map((order) => order.number);
  }
}

@Module({
  imports: [TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "shop" }), TypemoModule.forFeature([Order])],
  controllers: [OrdersController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useValue: new PolicyInterceptor({
        tenant: (request) => request.headers["x-tenant"],
        actor: (request) => request.headers["x-user"],
      }),
    },
  ],
})
export class ShopModule {}
```

The interceptor is built with `new`. Wire it by `app.useGlobalInterceptors(new PolicyInterceptor(...))`, `@UseInterceptors(new PolicyInterceptor(...))`, or `{ provide: APP_INTERCEPTOR, useValue: new PolicyInterceptor(...) }`.

- `tenant` and `actor`: `(request) => unknown`, **synchronous**. The context opens before the handler runs, so an async tenant could not be awaited inside it. Resolve it earlier (a guard or an authentication middleware) and put it on the request.
- Default request type `PolicyRequest` has only `headers`. For your own request give the type: `new PolicyInterceptor<AuthRequest>({ tenant: (request) => request.user.orgId })`.
- A resolver that returns `undefined` sets nothing: a tenant model then rejects the operation with `StrictModeError` (reason `tenant`), and `TypemoExceptionFilter` answers 400 `{ message: "Not allowed", reason: "tenant" }`. A request without an organization never turns into a request over all organizations. Models without a tenant policy work without a tenant.
- An empty tenant (`null`, `""`) is rejected by the core. "No tenant" is written explicitly with `@AllTenants()`.
- HTTP only. In queues, schedules, GraphQL and microservices open the context yourself with `PolicyContext.run`.

```ts
import { PolicyInterceptor } from "@venloc/typemo-nestjs";

interface AuthRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly user: { readonly orgId: string; readonly id: string };
}

export const interceptor = new PolicyInterceptor<AuthRequest>({
  tenant: (request) => request.user.orgId,
  actor: (request) => request.user.id,
});
```

## @AllTenants

`@AllTenants()` on a handler or a controller replaces the request tenant with `allTenants: true`: operations see the documents of all tenants. Use it for admin routes. `GET /orders/all` with it returns the orders of every tenant; the same route without the decorator and without the header is 400.

```ts
import { Controller, Get } from "@nestjs/common";
import { Entity, type Model, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";
import { AllTenants, InjectModel } from "@venloc/typemo-nestjs";

@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}

@Controller("admin/orders")
export class AdminOrdersController {
  constructor(@InjectModel(Order) private readonly orders: Model<Order>) {}

  @AllTenants()
  @Get()
  async all() {
    return (await this.orders.find().sort({ number: 1 }).plain()).map((order) => `${order.tenantId}:${order.number}`);
  }
}
```

## Common mistakes

Bad: a `@Transactional()` method calls another `@Transactional()` method.
```text
ConfigurationError: transaction(): transactions do not nest (already inside a transaction of this client)
```
Good: mark the inner method `@Transactional({ join: true })`.

Bad: the service was created with `new` (or in a unit test with no client mock), so no application bound it.
```text
ConfigurationError: @Transactional(): AccountsService.openTwo was called on an object no Nest application with TypemoModule has registered; it works on the providers and controllers of such an application
```
Good: take the service from the container (`moduleRef.get`); in a unit test add `...provideClientMock()` and `await moduleRef.init()`.

Bad: `client` names a client that no `forRoot` created.
```text
ConfigurationError: @Transactional(): no TypemoClient named "missing" in this application (TypemoModule.forRoot(uri, { name: "missing" }))
```
Good: the same name as in `forRoot(uri, { name })`.

Bad: `@Transactional()` on a static method.
```text
ConfigurationError: @Transactional(): Wrong.run is static; decorate an instance method
```
Good: an instance method of a provider.

Bad: `join` inside a transaction of another client, or options with `join`.
```text
ConfigurationError: @Transactional({ join: true }): LedgerService.entry was called inside a transaction of another client; it joins only a transaction of client "default"
ConfigurationError: @Transactional({ join: true }): timeoutMS cannot go with join; a joined method runs in the outer transaction, give the options to it
```
Good: give transaction options to the outermost method; keep one client per transaction.

Bad: the interceptor on a non-HTTP context, an async or non-function resolver.
```text
ConfigurationError: PolicyInterceptor works in HTTP handlers only, got a "rpc" context
ConfigurationError: PolicyInterceptor: tenant is a function of the request, got string
ConfigurationError: PolicyInterceptor: tenant returned a promise; resolve it from the request at once
```
Good: `PolicyContext.run` outside HTTP; a synchronous resolver; a guard that puts the tenant on the request.

Bad: a transactional method that loads a document outside, mutates it inside (`account.balance -= 10`), and saves it. A retry applies the change twice. Good: `updateOne(..., { $inc })` inside the method.

## Self-check

- [ ] Replica set under every `@Transactional`; methods are `async`.
- [ ] Methods callable alone and from another transactional method have `join: true`; no options with `join`.
- [ ] The method is safe to run twice (atomic operators, reads inside).
- [ ] `PolicyInterceptor` is registered once (global); its resolver is synchronous and reads the request only.
- [ ] Admin or cross-tenant routes carry `@AllTenants()`; nothing relies on an empty tenant value.
- [ ] Services are taken from the container, never created by `new`.
