import {
  type BaseTransportOptions,
  type Breadcrumb,
  createStackParser,
  createTransport,
  type ErrorEvent,
  setCurrentClient,
  type Transport,
} from "@sentry/core";
import { ServerRuntimeClient } from "@sentry/core/server";

// A minimal in-memory Sentry client for tests (an in-memory test transport), built only from
// `@sentry/core` (no `@sentry/node`): `ServerRuntimeClient` is the same base class `@sentry/node` and
// `@sentry/bun` use, wired with `beforeSend`/`beforeBreadcrumb` hooks that record everything instead of
// sending it anywhere. This exercises the exact `@sentry/core` API surface `TypemoSentry` calls.

/** What the in-memory Sentry client captured, in call order. */
export interface CapturedSentry {
  readonly events: ErrorEvent[];
  readonly breadcrumbs: Breadcrumb[];
}

export interface TestSentry {
  readonly captured: CapturedSentry;
  readonly reset: () => void;
  /** `captureException`'s event pipeline is asynchronous (`eventFromException` is a `PromiseLike`):
   * await this after an operation before asserting on `captured.events`. */
  readonly flush: () => Promise<void>;
}

/** Installs a fresh in-memory Sentry client as the current client (module-global, like the real SDKs'
 * `init()`) and returns what it captures. Call once per test (or `reset()` between tests). */
export const setUpTestSentry = (): TestSentry => {
  const events: ErrorEvent[] = [];
  const breadcrumbs: CapturedSentry["breadcrumbs"] = [];

  const client = new ServerRuntimeClient({
    dsn: "https://public@example.test/1",
    integrations: [],
    stackParser: createStackParser(),
    transport: (transportOptions: BaseTransportOptions): Transport =>
      createTransport(transportOptions, () => Promise.resolve({ statusCode: 200 })),
    beforeSend: (event: ErrorEvent): ErrorEvent | null => {
      events.push(event);
      return null; // never actually "sent": no network in a test
    },
    beforeBreadcrumb: (breadcrumb: Breadcrumb): Breadcrumb => {
      breadcrumbs.push(breadcrumb);
      return breadcrumb;
    },
  });
  setCurrentClient(client);
  client.init();

  return {
    captured: { events, breadcrumbs },
    reset: () => {
      events.length = 0;
      breadcrumbs.length = 0;
    },
    flush: async () => {
      await client.flush(1000);
    },
  };
};
