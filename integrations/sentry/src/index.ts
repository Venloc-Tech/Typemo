/*
 * `@venloc/typemo-sentry`: the Sentry adapter for `@venloc/typemo`'s instrumentation events (errors,
 * breadcrumbs and context) on top of `@sentry/core` alone. Tracing comes from
 * `@venloc/typemo-opentelemetry` (Sentry v8+ tracing is OpenTelemetry-based).
 */
export { BreadcrumbBuilder } from "./breadcrumb-builder.ts";
export { ErrorContextBuilder, type TypemoErrorContext } from "./error-context.ts";
export { type SentryInstrumentationOptions, SentrySubscriber } from "./sentry-subscriber.ts";
export { type InstrumentationTarget, TypemoSentry } from "./typemo-sentry.ts";
