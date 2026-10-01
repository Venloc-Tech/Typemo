import { addBreadcrumb, captureException } from "@sentry/core";
import type {
  InstrumentationEvent,
  InstrumentationSubscriber,
  OperationEndEvent,
  OperationErrorEvent,
  OperationSummary,
  SubscriberSensitive,
} from "@venloc/typemo";
import { BreadcrumbBuilder } from "./breadcrumb-builder.ts";
import { ErrorContextBuilder } from "./error-context.ts";

/**
 * Options of `TypemoSentry.instrument()`.
 *
 * @example
 * ```ts
 * const options: SentryInstrumentationOptions = { captureErrors: true, breadcrumbs: false, includeTenant: false };
 * TypemoSentry.instrument(Typemo, options);
 * ```
 */
export interface SentryInstrumentationOptions {
  /**
   * Capture every operation error with `captureException` (all errors, by design, no filtering by kind).
   * Default `true`; `false` keeps only breadcrumbs.
   */
  readonly captureErrors?: boolean;
  /** Add a breadcrumb per operation end/error. Default `true`. */
  readonly breadcrumbs?: boolean;
  /**
   * Same meaning as the core's `InstrumentationSubscriber.sensitive` (default `"mask"`): unmarked document
   * values leave the process only with `"show"` or through your `{ mask }`, in summaries and in the captured
   * errors (values of `CastError`, `ValidationError`, `DuplicateKeyError` and `ServerValidationError`);
   * schema `sensitive` marks and `Hidden` fields always apply.
   */
  readonly sensitive?: SubscriberSensitive;
  /**
   * Put the operation's tenant into a captured error: the `typemo.tenant` tag and `tenant` of
   * `contexts.typemo` (breadcrumbs never carry it). Default `false`, because a tenant is data.
   */
  readonly includeTenant?: boolean;
}

const DEFAULT_CAPTURE_ERRORS = true;
const DEFAULT_BREADCRUMBS = true;
const DEFAULT_SENSITIVE: SubscriberSensitive = "mask";
const DEFAULT_INCLUDE_TENANT = false;

/**
 * Logs a failure of the subscriber itself. Mirrors the core's own contract: an observer must not break the
 * operation it observes.
 *
 * @param error - The error thrown while handling an event.
 */
const report = (error: unknown): void => {
  console.error("[typemo-sentry] an instrumentation subscriber failed:", error);
};

/**
 * One `TypemoSentry.instrument()` registration. Turns `operation.end`/`operation.error` into breadcrumbs
 * and `operation.error` into a Sentry `captureException`, using only the `@sentry/core` API, so it works
 * the same with `@sentry/node` and `@sentry/bun`.
 *
 * Keeps the masked `summary` of open operations, keyed by `operationId`: it is attached to
 * `operation.start` (computed lazily by the core) but the breadcrumb is only emitted at
 * `operation.end`/`operation.error`.
 */
export class SentrySubscriber implements InstrumentationSubscriber {
  /** How unmarked document values are shown to this subscriber. */
  readonly sensitive: SubscriberSensitive;
  /** Whether the tenant is put into Sentry events. */
  readonly includeTenant: boolean;
  /** The event handler the core calls. */
  readonly handle: (event: InstrumentationEvent) => void;

  readonly #captureErrors: boolean;
  readonly #breadcrumbs: boolean;
  readonly #summaries = new Map<number, OperationSummary>();

  /**
   * @param options - Adapter options; every field has a default.
   */
  constructor(options: SentryInstrumentationOptions = {}) {
    this.sensitive = options.sensitive ?? DEFAULT_SENSITIVE;
    this.includeTenant = options.includeTenant ?? DEFAULT_INCLUDE_TENANT;
    this.#captureErrors = options.captureErrors ?? DEFAULT_CAPTURE_ERRORS;
    this.#breadcrumbs = options.breadcrumbs ?? DEFAULT_BREADCRUMBS;
    this.handle = (event) => this.#onEvent(event);
  }

  /**
   * Dispatches one event; a failure is logged, never thrown.
   *
   * @param event - The instrumentation event.
   */
  #onEvent(event: InstrumentationEvent): void {
    try {
      switch (event.type) {
        case "operation.start":
          this.#summaries.set(event.operationId, event.summary);
          return;
        case "operation.end":
          this.#onEnd(event);
          return;
        case "operation.error":
          this.#onError(event);
          return;
        case "instrumentation.error":
          /* A mask function failed while the core shaped an event; the error names the path, not the value. */
          if (this.#captureErrors)
            captureException(event.error, {
              tags: {
                "typemo.instrumentation.source": event.source,
                ...(event.model === undefined ? {} : { "typemo.model": event.model }),
              },
              contexts: { typemo: { source: event.source, model: event.model, path: event.path } },
            });
          return;
        case "transaction.retry":
        case "transaction.abort":
          /* A retried or aborted transaction explains the operations around it (no option of its own). */
          if (this.#breadcrumbs) addBreadcrumb(BreadcrumbBuilder.forTransaction(event));
          return;
        default:
          /*
           * Steps, cursor batches, other transaction events, driver commands and pool events are not reported
           * by this adapter; the OpenTelemetry adapter is where the rest of the pipeline becomes spans and
           * metrics.
           */
          return;
      }
    } catch (error) {
      report(error);
    }
  }

  /**
   * Emits the breadcrumb of a finished operation.
   *
   * @param event - The `operation.end` event.
   */
  #onEnd(event: OperationEndEvent): void {
    const summary = this.#take(event.operationId);
    if (this.#breadcrumbs) addBreadcrumb(BreadcrumbBuilder.forEnd(event, summary));
  }

  /**
   * Emits the breadcrumb and captures the error of a failed operation.
   *
   * @param event - The `operation.error` event.
   */
  #onError(event: OperationErrorEvent): void {
    const summary = this.#take(event.operationId);
    if (this.#breadcrumbs) addBreadcrumb(BreadcrumbBuilder.forError(event, summary));
    if (this.#captureErrors) this.#capture(event);
  }

  /**
   * `captureException`: one error, one Sentry event. `Client.captureException` already applies
   * `@sentry/core`'s own dedup convention (`checkOrSetAlreadyCaught`/`__sentry_captured__`) internally;
   * calling it again here would only mark the exception as captured a second time before the client's own
   * check runs, making the client skip it. So this subscriber captures unconditionally and both directions
   * of "one error, one event" hold for free: two subscriptions on the same failure only produce one event,
   * and an app that captures the same error again after this adapter does is a no-op too.
   *
   * @param event - The `operation.error` event.
   */
  #capture(event: OperationErrorEvent): void {
    captureException(event.error, {
      contexts: { typemo: ErrorContextBuilder.context(event, this.includeTenant) },
      tags: ErrorContextBuilder.tags(event, this.includeTenant),
    });
  }

  /**
   * Removes and returns the summary stored for an operation.
   *
   * @param operationId - The operation id.
   * @returns The summary, or `undefined` when none was stored.
   */
  #take(operationId: number): OperationSummary | undefined {
    const summary = this.#summaries.get(operationId);
    this.#summaries.delete(operationId);
    return summary;
  }
}
