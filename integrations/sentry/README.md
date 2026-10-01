# @venloc/typemo-sentry

**Sentry integration for [`@venloc/typemo`](https://www.npmjs.com/package/@venloc/typemo).** It adds the Typemo context to errors reported to Sentry — the operation, the model, the collection, the database, the error kind — and leaves a breadcrumb for each operation, so an error report shows what the application did with the database right before it. Values marked `sensitive` or `Hidden` are masked; the server's raw text and connection details are not sent.

The core has no vendor code: this package only subscribes to the core's events.

```bash
bun add @venloc/typemo @venloc/typemo-sentry @sentry/core
```

```ts
import { TypemoClient } from "@venloc/typemo";
import { TypemoSentry } from "@venloc/typemo-sentry";

// after Sentry.init(...):
const client = new TypemoClient("mongodb://localhost:27017/app");
const subscription = TypemoSentry.instrument(client);

// every client of the process: TypemoSentry.instrument(Typemo)
// stop: subscription.unsubscribe()
```

## Options

```ts
import { TypemoSentry } from "@venloc/typemo-sentry";
import type { TypemoClient } from "@venloc/typemo";
declare const client: TypemoClient;
TypemoSentry.instrument(client, {
  captureErrors: false, // only breadcrumbs and context; report errors yourself
  includeTenant: true, // the tenant in the context (off by default)
});
```

## Requirements

`@venloc/typemo` 1.x and `@sentry/core` 11+ as peer dependencies (works with the Sentry SDK of your runtime, for example `@sentry/node` or `@sentry/bun`).

## Links

- Repository and issues: https://github.com/Venloc-Tech/typemo
- License: MIT
