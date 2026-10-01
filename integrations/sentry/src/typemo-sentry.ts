import type { InstrumentationSubscriber, Subscription } from "@venloc/typemo";
import { type SentryInstrumentationOptions, SentrySubscriber } from "./sentry-subscriber.ts";

/**
 * Anything that accepts an instrumentation subscriber: `Typemo` itself (global, `Typemo.instrument`) or a
 * `TypemoClient` instance (`client.instrument`). Both satisfy this structurally, so no import of either is
 * needed here.
 *
 * @example
 * ```ts
 * const target: InstrumentationTarget = Typemo;
 * TypemoSentry.instrument(target);
 * ```
 */
export interface InstrumentationTarget {
  /** Registers a subscriber and returns the handle that removes it. */
  readonly instrument: (subscriber: InstrumentationSubscriber) => Subscription;
}

/**
 * `@venloc/typemo-sentry`: turns the core's instrumentation events into Sentry breadcrumbs and captured
 * errors, using only the `@sentry/core` API, so it works the same with `@sentry/node` and `@sentry/bun`.
 *
 * Tracing is not this adapter's job: Sentry v8+ tracing is OpenTelemetry-based, so spans come from
 * `@venloc/typemo-opentelemetry` once Sentry is configured to read from OpenTelemetry.
 */
export class TypemoSentry {
  /**
   * Registers the Sentry adapter on a target.
   *
   * @param target - `Typemo` or a client.
   * @param options - Adapter options.
   * @returns The subscription; unsubscribe to stop reporting.
   */
  static instrument(target: InstrumentationTarget, options: SentryInstrumentationOptions = {}): Subscription {
    return target.instrument(new SentrySubscriber(options));
  }
}
