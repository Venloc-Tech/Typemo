# Typemo

**A strictly typed ODM for MongoDB, written from scratch in TypeScript — a replacement for Mongoose.**

A schema is a class with decorators, and the class is the type. Filters, updates, projections, `populate`, aggregation pipelines, results and errors are typed from it — the types are inferred from the implementation, not glued on top of an untyped runtime, and the tests check that the compiler's type of a result equals the shape the real MongoDB returns. The transport is the official `mongodb` driver.

**Strict by default, with no switch to turn it off.** A wrong field name, a value of the wrong type, an empty filter on a write, an operator object from a client, an option nobody reads, a hook that can never run — each is a compile error or a clear error at run time. An error instead of silent behaviour.

```ts
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) email!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
  @Prop(() => [String]) tags!: string[];
}

const client = await TypemoClient.connect("mongodb://localhost:27017/app?replicaSet=rs0");
await client.connection.init(); // collections and indexes: created explicitly, never as a side effect
const Accounts = client.connection.model(Account);

await Accounts.create({ email: "ann@example.com", balance: 100 });
const rich = await Accounts.find({ balance: { $gt: 50 } }).select({ email: 1 }).lean();
//    ^? { _id: ObjectId; email: string }[]
```

## Packages

| Package | What it is |
| --- | --- |
| [`@venloc/typemo`](packages/typemo) | the core: schemas with legacy decorators, models, queries, writes, documents, populate, aggregation, transactions, hooks, plugins, policies, collections, errors, `testing` helpers |
| [`@venloc/typemo-decorators`](packages/decorators) | standard (TC39) decorators for projects without `experimentalDecorators` |
| [`@venloc/typemo-nestjs`](integrations/nestjs) | NestJS module: models in DI by class, `@Transactional()`, tenant from the request, HTTP error mapping, pipes, test helpers |
| [`@venloc/typemo-opentelemetry`](integrations/opentelemetry) | OpenTelemetry spans and metrics |
| [`@venloc/typemo-sentry`](integrations/sentry) | Sentry error context and breadcrumbs |

Integrations are separate packages: the core has no vendor code and does no extra work without a subscriber.

## Highlights

- **Types that match the database.** One predictable type per result form: hydrated documents (`HydratedDoc<T>`, `HydratedDocWith<T, {…}>`), `.lean()`, `.plain()`, JSON. Hover hints show the fields, not internal types.
- **Typed everything.** Filters with the right operators per field, update operators and update pipelines, projections (literal, declared or dynamic), `populate` with `null` for a dangling reference, a pipeline builder where every stage knows its row type.
- **Safe writes.** Values are cast and validated before anything is sent; immutable fields are guarded on the server; `updateOne({})` does not compile.
- **Policies built in.** Multi-tenancy, soft delete, audit trail, untrusted input, masking of sensitive values in errors, events and responses.
- **Operations you can see.** Instrumentation events for every operation, transaction and driver command; adapters for OpenTelemetry and Sentry.
- **Agent-ready.** The core and the NestJS packages ship agent skills (`skills/typemo`, `skills/typemo-nestjs`) for AI coding agents.

## Requirements

- TypeScript 6. Legacy decorators: `experimentalDecorators: true` only (`emitDecoratorMetadata` and `reflect-metadata` are not needed). Standard decorators: `@venloc/typemo-decorators`.
- `mongodb` 7.6 and `bson` 7.3 (peer dependencies). Tested on MongoDB 8.3 and 9.0, with Bun and Node.
- A replica set (one member is enough) for transactions, change streams and audited models.

## Documentation

- User documentation (Russian, `v1`): [docs/ru/v1](docs/ru/v1) — guides and an API reference; every example compiles.
- Moving from Mongoose: [docs/ru/v1/migration](docs/ru/v1/migration) — the step-by-step guide and every behaviour that differs.
- Agent skills: [skills/](skills).

## Development

The repository is a Bun workspace. Tests run on a real MongoDB (`mongodb-memory-server`, a replica set).

```bash
bun install
bun run build            # build every package into dist (+ skills and LICENSE copied in)
bun run test             # every package's tests (MongoDB 9.0)
TYPEMO_MONGO=stable bun run test   # the same on MongoDB 8.3
bun run typecheck        # tsc -b
bun run test:types       # every test file through tsc
bun run test:dist        # the built packages installed into a clean project (types, hovers, Node run)
bun run test:decorators  # the shared suite in legacy and TC39 mode
bun run test:perf        # performance guards
bun run lint             # biome
bun run check:any        # no `any` in the public API
bun run check:tsdoc      # every public TSDoc example compiles
bun run check:skills     # every agent-skill example compiles
bun scripts/docs-check.ts --types docs/ru/v1/<page>.mdx   # a documentation page
```

Publishing: `bun run release:dry` (everything except the upload), then `bun run release`.

Rules for contributors and AI agents: [CLAUDE.md](CLAUDE.md) and the skill [skills/typemo-contributing](skills/typemo-contributing).

## License

[MIT](LICENSE) © Shiz-Ceo
