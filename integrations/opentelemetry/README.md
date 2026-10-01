# @venloc/typemo-opentelemetry

**OpenTelemetry instrumentation for [`@venloc/typemo`](https://www.npmjs.com/package/@venloc/typemo).** It turns Typemo's instrumentation events into spans and metrics: one span per operation (`find`, `updateOne`, `aggregate`, a transaction, …) with the model, the collection and the database, optional spans of the pipeline steps and of the driver commands, and operation metrics. Values marked `sensitive` or `Hidden` are masked before they reach a span.

The core has no vendor code: this package only subscribes to the core's events, and without it (or without a subscriber) the core does no extra work.

```bash
bun add @venloc/typemo @venloc/typemo-opentelemetry @opentelemetry/api
```

```ts
import { TypemoClient } from "@venloc/typemo";
import { TypemoOpenTelemetry } from "@venloc/typemo-opentelemetry";

// after the OpenTelemetry SDK is set up:
const client = new TypemoClient("mongodb://localhost:27017/app");
const subscription = TypemoOpenTelemetry.instrument(client);

// every client of the process: TypemoOpenTelemetry.instrument(Typemo)
// stop: subscription.unsubscribe()
```

## Options

```ts
import { TypemoOpenTelemetry } from "@venloc/typemo-opentelemetry";
import type { TypemoClient } from "@venloc/typemo";
declare const client: TypemoClient;
TypemoOpenTelemetry.instrument(client, {
  stepSpans: true, // a span per pipeline step (cast, validate, hooks, …)
  commandSpans: true, // a span per driver command
  sensitive: "mask", // how sensitive values appear in attributes
  includeTenant: false, // the tenant as an attribute
});
```

Span attributes follow the OpenTelemetry database semantic conventions (`db.system.name`, `db.namespace`, `db.collection.name`, `db.operation.name`, `server.address`, `server.port`), plus `typemo.*` attributes. A database-level operation (no model) has no collection attribute.

## Requirements

`@venloc/typemo` 1.x and `@opentelemetry/api` 1.9+ as peer dependencies; an OpenTelemetry SDK configured by your application.

## Links

- Repository and issues: https://github.com/Venloc-Tech/typemo
- License: MIT
