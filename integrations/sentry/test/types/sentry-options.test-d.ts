// Type tests of `SentryInstrumentationOptions` / `TypemoSentry.instrument`: every option is
// optional and independently typed; `target` accepts both `Typemo` (the class) and a `TypemoClient`.

import { type Subscription, Typemo, type TypemoClient } from "@venloc/typemo";
import { expectTypeOf } from "@venloc/typemo-test-kit";
import { type SentryInstrumentationOptions, TypemoSentry } from "../../src/index.ts";

declare const client: TypemoClient;

// Positive: both kinds of target …
expectTypeOf(TypemoSentry.instrument(Typemo, {})).toEqualTypeOf<Subscription>();
expectTypeOf(TypemoSentry.instrument(client, {})).toEqualTypeOf<Subscription>();

// … no options at all …
expectTypeOf(TypemoSentry.instrument(client)).toEqualTypeOf<Subscription>();

// … every option on its own, and all together.
TypemoSentry.instrument(client, { captureErrors: false });
TypemoSentry.instrument(client, { breadcrumbs: false });
TypemoSentry.instrument(client, { sensitive: "show" });
TypemoSentry.instrument(client, { sensitive: "hide" });
TypemoSentry.instrument(client, { sensitive: { mask: (value, { path }) => `${path}:${typeof value}` } });
// @ts-expect-error the subscriber mask gets { path } only
TypemoSentry.instrument(client, { sensitive: { mask: (_value, { dbPath }) => String(dbPath) } });
TypemoSentry.instrument(client, { includeTenant: true });
TypemoSentry.instrument(client, {
  captureErrors: true,
  breadcrumbs: true,
  sensitive: "mask",
  includeTenant: false,
});

declare const options: SentryInstrumentationOptions;
expectTypeOf(options.captureErrors).toEqualTypeOf<boolean | undefined>();
expectTypeOf(options.breadcrumbs).toEqualTypeOf<boolean | undefined>();
expectTypeOf(options.includeTenant).toEqualTypeOf<boolean | undefined>();

// Negative: an unknown sensitive mode, an unknown option, and a target without `instrument`.
// @ts-expect-error sensitive is "mask" | "show" | "hide" | { mask }
TypemoSentry.instrument(client, { sensitive: "full" });
// @ts-expect-error not an option of SentryInstrumentationOptions
TypemoSentry.instrument(client, { commandSpans: false });
// @ts-expect-error not an instrumentation target: no `instrument` method
TypemoSentry.instrument({ foo: 1 }, {});
