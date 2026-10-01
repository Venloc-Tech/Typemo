// Type tests of `TypemoOpenTelemetry.instrument`: targets, options, the returned subscription.
import type { TracerProvider } from "@opentelemetry/api";
import { type SensitiveJson, type Subscription, Typemo, type TypemoClient } from "@venloc/typemo";
import { expectTypeOf } from "expect-type";
import { type OpenTelemetryOptions, TypemoOpenTelemetry } from "../src/index.ts";

declare const client: TypemoClient;
declare const tracerProvider: TracerProvider;

expectTypeOf(TypemoOpenTelemetry.instrument(client)).toEqualTypeOf<Subscription>();
expectTypeOf(
  TypemoOpenTelemetry.instrument(Typemo, { tracerProvider, sensitive: "show" }),
).toEqualTypeOf<Subscription>();
expectTypeOf<OpenTelemetryOptions["sensitive"]>().toEqualTypeOf<
  | "mask"
  | "show"
  | "hide"
  | { readonly mask: (value: unknown, context: { readonly path: string }) => SensitiveJson }
  | undefined
>();
TypemoOpenTelemetry.instrument(client, { sensitive: "hide" });
TypemoOpenTelemetry.instrument(client, {
  sensitive: {
    mask: (value, { path }) => {
      expectTypeOf(value).toEqualTypeOf<unknown>();
      expectTypeOf(path).toEqualTypeOf<string>();
      return path;
    },
  },
});
// @ts-expect-error — a subscriber mask returns JSON, not a Date
TypemoOpenTelemetry.instrument(client, { sensitive: { mask: () => new Date() } });
expectTypeOf<OpenTelemetryOptions["commandSpans"]>().toEqualTypeOf<boolean | undefined>();

// @ts-expect-error — sensitive is a mode or { mask }, not a boolean
TypemoOpenTelemetry.instrument(client, { sensitive: false });
// @ts-expect-error — an unknown option is rejected
TypemoOpenTelemetry.instrument(client, { spans: true });
// @ts-expect-error — a target must have instrument(subscriber)
TypemoOpenTelemetry.instrument({}, {});
