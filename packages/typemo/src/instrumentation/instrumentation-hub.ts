import { ConfigurationError } from "../errors/configuration-error.ts";
import { type MaskFailureSink, SensitiveMask } from "../policies/sensitive-mask.ts";
import type { SensitiveJson } from "../schema/options/prop-options.ts";
import type { EmittedEvent, InstrumentationEvent, OperationInfo } from "./instrumentation-events.ts";

/**
 * How the values of filters, updates, pipelines, projections and errors appear in events (the subscriber option
 * `sensitive`). Fields marked `sensitive` in the schema keep their own mode whatever the subscriber says.
 *
 * @example
 * ```ts
 * const mode: SubscriberSensitive = { mask: (value, { path }) => (path === "email" ? "[email]" : "?") };
 * ```
 */
export type SubscriberSensitive =
  /** Default: every unmarked value is `"?"`. */
  | "mask"
  /** The real (cast) values of unmarked fields. Only by explicit choice: the events then carry user data. */
  | "show"
  /**
   * Every unmarked condition collapses whole into `"[hidden]"`: the key stays, its operators are not shown.
   */
  | "hide"
  /**
   * Every unmarked value goes through `mask` (`path`: the dotted DB path of the value, empty outside fields).
   * A throw gives `"?"` and is reported.
   */
  | { readonly mask: (value: unknown, context: { readonly path: string }) => SensitiveJson };

/**
 * A consumer of instrumentation events (an adapter, a test, a logger).
 *
 * @example
 * ```ts
 * const subscriber: InstrumentationSubscriber = {
 *   handle: (event) => console.log(event.type),
 *   driverCommands: true,
 * };
 * ```
 */
export interface InstrumentationSubscriber {
  /** Receives every event; switch on `event.type`. Must not throw (a throw is reported, the operation goes on). */
  readonly handle: (event: InstrumentationEvent) => void;
  /** How values appear in the events this subscriber gets. Default `"mask"`. */
  readonly sensitive?: SubscriberSensitive;
  /** Also receive the driver's command events, linked to the operations (`driver.command.*`). Default `false`. */
  readonly driverCommands?: boolean;
  /** Also receive the driver's connection pool events (`driver.pool`, CMAP). Default `false`. */
  readonly poolEvents?: boolean;
  /**
   * Receive the nested `operation.step` events (cast, validate, hooks, populate). Default `true`; with `false`
   * on every subscriber the step events are not built at all.
   */
  readonly steps?: boolean;
  /** Put the operation's tenant (tenant policy) into `OperationInfo.tenant`. Default `false`, because a tenant is data. */
  readonly includeTenant?: boolean;
  /**
   * Runs around the execution of every operation: the core calls `run` inside it, so an adapter can make its
   * context active for everything the operation does (OpenTelemetry: `context.with(ctx, run)`, so the spans of
   * user hooks, populate sub-queries and driver commands nest under the operation's span).
   * Called only when a subscriber gives it (zero cost otherwise); several `wrap`s nest in registration order
   * (own before global, the first registered outermost).
   *
   * Contract: call `run` exactly once and return (or await) what it returns. The operation's outcome is always
   * the one of `run`, whatever `wrap` returns. A `wrap` that throws or rejects before calling `run`, or never
   * calls it, is reported like a throwing `handle` and the operation runs anyway; a rejection after `run` is
   * reported and ignored. For a cursor `wrap` covers the opening (up to the first batch request), not the
   * batches.
   */
  readonly wrap?: (operation: OperationInfo, run: () => Promise<void>) => Promise<unknown>;
}

/**
 * A registration; `unsubscribe()` (or `using`) ends it.
 *
 * @example
 * ```ts
 * const subscription: Subscription = Typemo.instrument({ handle: () => {} });
 * subscription.unsubscribe();
 * ```
 */
export interface Subscription {
  /** Ends the registration. */
  readonly unsubscribe: () => void;
  /** Ends the registration when the subscription goes out of a `using` scope. */
  readonly [Symbol.dispose]: () => void;
}

/**
 * What the subscribers of a hub (own and inherited) want; recomputed only when a list changes.
 *
 * @example
 * ```ts
 * const wantsCommands = (state: HubState): boolean => state.driverCommands;
 * ```
 */
interface HubState {
  /** Own and inherited subscribers. */
  readonly subscribers: readonly InstrumentationSubscriber[];
  /** Some subscriber wants driver command events. */
  readonly driverCommands: boolean;
  /** Some subscriber wants pool events. */
  readonly poolEvents: boolean;
  /** Some subscriber wants values in a form other than `"mask"`. */
  readonly values: boolean;
  /** Some subscriber wants step events. */
  readonly steps: boolean;
  /** Some subscriber wants the tenant. */
  readonly tenant: boolean;
  /** The subscribers that give a `wrap`. */
  readonly wrappers: readonly InstrumentationSubscriber[];
}

/**
 * Reports a failure of a subscriber. An observer must not break the operation it observes, so the failure is
 * logged, not thrown, and not hidden.
 *
 * @param what - Where it happened, for the message.
 * @param error - The failure.
 */
const report = (what: string, error: unknown): void => {
  console.error(`[typemo] an instrumentation subscriber threw ${what}:`, error);
};

/**
 * The subscribers of one scope (global: `Typemo.instrument`, or one client: `client.instrument`).
 *
 * It costs nothing without subscribers: `enabled` is a plain check of two lists, and every event object is built
 * only after it. `diagnostics_channel.hasSubscribers` is not used, because Bun 1.4 lacks it.
 */
export class InstrumentationHub {
  /**
   * Process-wide subscribers (`Typemo.instrument`). Built with `new this`: with `useDefineForClassFields` off,
   * TypeScript aliases the class name here when a method refers to it from a closure, and the alias is assigned
   * only after the class body, so the emitted code failed when the module loaded.
   */
  static readonly global = new this(undefined);

  readonly #parent: InstrumentationHub | undefined;
  #subscribers: readonly InstrumentationSubscriber[] = [];
  readonly #listeners = new Set<() => void>();
  /** Bumped on every change of the own list (children compare it to drop their cached state). */
  #version = 0;
  #state: HubState | undefined;
  #stateParentVersion = -1;

  /**
   * @param parent - The hub whose subscribers this one inherits (`undefined` for the global hub).
   */
  constructor(parent: InstrumentationHub | undefined) {
    this.#parent = parent;
  }

  /** `true` when at least one subscriber (own or inherited) listens. */
  get enabled(): boolean {
    return this.#subscribers.length > 0 || this.#parent?.enabled === true;
  }

  /** Own and inherited subscribers. */
  get subscribers(): readonly InstrumentationSubscriber[] {
    return this.#current().subscribers;
  }

  /** `true` when some subscriber wants the driver's command events. */
  get wantsDriverCommands(): boolean {
    return this.#current().driverCommands;
  }

  /** `true` when some subscriber wants the pool events. */
  get wantsPoolEvents(): boolean {
    return this.#current().poolEvents;
  }

  /** `true` when some subscriber wants another form than the default `"mask"` (`show`, `hide`, a function). */
  get wantsValues(): boolean {
    return this.#current().values;
  }

  /** `true` when some subscriber wants the `operation.step` events. */
  get wantsSteps(): boolean {
    return this.enabled && this.#current().steps;
  }

  /** `true` when some subscriber wants the tenant (`includeTenant`). */
  get wantsTenant(): boolean {
    return this.#current().tenant;
  }

  /** `true` when some subscriber gives a `wrap`. */
  get wraps(): boolean {
    return this.enabled && this.#current().wrappers.length > 0;
  }

  /**
   * Registers a subscriber.
   *
   * @param subscriber - The subscriber to register.
   * @returns The subscription; `unsubscribe()` ends it.
   * @throws {ConfigurationError} When `handle`, `sensitive` or `wrap` has the wrong form.
   */
  subscribe(subscriber: InstrumentationSubscriber): Subscription {
    if (typeof subscriber?.handle !== "function") {
      throw new ConfigurationError("an instrumentation subscriber is an object { handle(event) }");
    }
    const sensitive: unknown = subscriber.sensitive;
    if (
      sensitive !== undefined &&
      sensitive !== "mask" &&
      sensitive !== "show" &&
      sensitive !== "hide" &&
      typeof (sensitive as { mask?: unknown } | null)?.mask !== "function"
    ) {
      throw new ConfigurationError(
        'the sensitive option of an instrumentation subscriber is "mask", "show", "hide" or { mask: (value, { path }) => json }',
      );
    }
    if (subscriber.wrap !== undefined && typeof subscriber.wrap !== "function") {
      throw new ConfigurationError(
        "an instrumentation subscriber's wrap must be a (operation, run) => Promise callback",
      );
    }
    this.#subscribers = [...this.#subscribers, subscriber];
    this.#changed();
    const unsubscribe = (): void => {
      this.#subscribers = this.#subscribers.filter((other) => other !== subscriber);
      this.#changed();
    };
    return { unsubscribe, [Symbol.dispose]: unsubscribe };
  }

  /**
   * Registers a listener for changes of the subscriber list, here or in the parent (clients attach or detach
   * driver listeners on it).
   *
   * @param listener - Called after each change.
   * @returns A function that removes the listener.
   */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    const detachParent = this.#parent?.onChange(listener);
    return () => {
      this.#listeners.delete(listener);
      detachParent?.();
    };
  }

  /**
   * Delivers an event to the subscribers.
   *
   * @param event - The event in the `sensitive: "mask"` form.
   * @param variant - Builds the form for another subscriber `sensitive` mode; the caller passes it only when
   * {@link wantsValues}, and it is built once per distinct mode.
   * @param tenant - Goes (as `tenant`) only to subscribers with `includeTenant: true`; the caller passes it only
   * when {@link wantsTenant}.
   */
  emit(event: EmittedEvent, variant?: (sensitive: SubscriberSensitive) => EmittedEvent, tenant?: unknown): void {
    if (event.type === "instrumentation.error") {
      /* A mask failing while this event is handled is logged, never re-emitted, so there is no loop. */
      SensitiveMask.reporting(
        (path, error) => report(`(sensitive mask of "${path}") on "instrumentation.error"`, error),
        () => this.#deliver(event, undefined, undefined),
      );
      return;
    }
    /* A mask function failing while an event is shaped (a variant, a lazy summary read by a subscriber) becomes
       an `instrumentation.error` event for the same subscribers, not a console line. */
    SensitiveMask.reporting(this.maskSink("model" in event ? (event.model ?? undefined) : undefined), () =>
      this.#deliver(event, variant, tenant),
    );
  }

  /**
   * Where a failed mask function of a model goes: an `instrumentation.error` event for the subscribers. It is
   * captured by work that runs outside {@link emit} (a lazy summary read later, the masked error built before
   * `emit`, the cast and validate steps); with no subscriber left by then, `console.error`, never silence.
   *
   * @param model - The model of the operation, when known.
   * @param once - Report each path once (an operation masks the same value for the thrown error and again for its
   * event).
   * @returns The sink to pass to `SensitiveMask.reporting`.
   */
  maskSink(model: string | undefined, once = false): MaskFailureSink {
    const seen = once ? new Set<string>() : undefined;
    return (path, error) => {
      if (seen !== undefined) {
        if (seen.has(path)) return;
        seen.add(path);
      }
      if (!this.enabled) {
        console.error('[typemo] instrumentation: a sensitive mask threw; the value is "?"', error);
        return;
      }
      this.emit({ type: "instrumentation.error", source: "sensitive-mask", timestamp: Date.now(), model, path, error });
    };
  }

  /**
   * Runs a synchronous function with mask failures going to {@link maskSink}; without subscribers it is a plain
   * call.
   *
   * @param model - The model of the operation, when known.
   * @param run - The function to run.
   * @returns The result of `run`.
   */
  reporting<T>(model: string | undefined, run: () => T): T {
    return this.enabled ? SensitiveMask.reporting(this.maskSink(model), run) : run();
  }

  /**
   * Hands an event to every subscriber in the form it asked for. A subscriber that throws is reported and the
   * others still get the event.
   *
   * @param event - The event in the `"mask"` form.
   * @param variant - Builds the form for another `sensitive` mode.
   * @param tenant - The tenant, for `includeTenant` subscribers.
   */
  #deliver(
    event: EmittedEvent,
    variant: ((sensitive: SubscriberSensitive) => EmittedEvent) | undefined,
    tenant: unknown,
  ): void {
    const step = event.type === "operation.step";
    let variants: Map<SubscriberSensitive, EmittedEvent> | undefined;
    for (const subscriber of this.subscribers) {
      if (step && subscriber.steps === false) continue;
      const sensitive = subscriber.sensitive;
      let delivered: InstrumentationEvent = event;
      if (variant !== undefined && sensitive !== undefined && sensitive !== "mask") {
        variants ??= new Map();
        let built = variants.get(sensitive);
        if (built === undefined) {
          built = variant(sensitive);
          variants.set(sensitive, built);
        }
        delivered = built;
      }
      if (tenant !== undefined && subscriber.includeTenant === true) {
        delivered = InstrumentationHub.withTenant(delivered, tenant);
      }
      try {
        subscriber.handle(delivered);
      } catch (error) {
        report(`on "${event.type}"`, error);
      }
    }
  }

  /**
   * Runs a function inside the `wrap` of every subscriber that gives one (outermost first). Call it only when
   * {@link wraps} is `true`.
   *
   * @param info - The operation, without the tenant.
   * @param tenant - Added to `info` for `includeTenant` subscribers.
   * @param run - The execution of the operation.
   * @returns A promise that settles when the operation and the wrappers are done.
   */
  around(info: OperationInfo, tenant: unknown, run: () => Promise<void>): Promise<void> {
    const wrappers = this.#current().wrappers;
    const invoke = (index: number): Promise<void> => {
      const subscriber = wrappers[index];
      if (subscriber?.wrap === undefined) return run();
      let inner: Promise<void> | undefined;
      const next = (): Promise<void> => {
        inner ??= invoke(index + 1);
        return inner;
      };
      const operation = tenant !== undefined && subscriber.includeTenant === true ? { ...info, tenant } : info;
      let wrapped: Promise<unknown>;
      try {
        wrapped = Promise.resolve(subscriber.wrap(operation, next));
      } catch (error) {
        report("in wrap", error);
        return next();
      }
      return wrapped.then(
        () => {
          if (inner === undefined) report("in wrap", new Error("wrap did not call run: the operation ran without it"));
          return next();
        },
        (error: unknown) => {
          /* A rejection that is the operation's own failure is not the subscriber's fault. */
          if (inner === undefined) report("in wrap", error);
          else return inner.then(() => report("in wrap (after run)", error));
          return next();
        },
      );
    };
    return invoke(0);
  }

  /**
   * Copies an operation event with the tenant added. The copy is made by property descriptors, which keeps the lazy
   * `summary` getter lazy (a spread would compute it).
   *
   * @param event - The event.
   * @param tenant - The tenant to add.
   * @returns The copy for operation events, the event itself for others.
   */
  private static withTenant(event: InstrumentationEvent, tenant: unknown): InstrumentationEvent {
    return event.type === "operation.start" || event.type === "operation.end" || event.type === "operation.error"
      ? (Object.defineProperties(
          {},
          {
            ...Object.getOwnPropertyDescriptors(event),
            tenant: { value: tenant, enumerable: true },
          },
        ) as InstrumentationEvent)
      : event;
  }

  /** The version of the subscriber lists up the chain; children cache their state against it. */
  get version(): number {
    /* Versions only grow, so the sum changes whenever any list up the chain changes. */
    return this.#version + (this.#parent?.version ?? 0);
  }

  /**
   * The cached state, rebuilt when a list in the chain changed.
   *
   * @returns What the current subscribers want.
   */
  #current(): HubState {
    const parentVersion = this.#parent?.version ?? 0;
    if (this.#state !== undefined && this.#stateParentVersion === parentVersion) return this.#state;
    const subscribers =
      this.#parent === undefined ? this.#subscribers : [...this.#subscribers, ...this.#parent.subscribers];
    this.#state = {
      subscribers,
      driverCommands: subscribers.some((subscriber) => subscriber.driverCommands === true),
      poolEvents: subscribers.some((subscriber) => subscriber.poolEvents === true),
      values: subscribers.some((subscriber) => subscriber.sensitive !== undefined && subscriber.sensitive !== "mask"),
      steps: subscribers.some((subscriber) => subscriber.steps !== false),
      tenant: subscribers.some((subscriber) => subscriber.includeTenant === true),
      wrappers: subscribers.filter((subscriber) => subscriber.wrap !== undefined),
    };
    this.#stateParentVersion = parentVersion;
    return this.#state;
  }

  /** Drops the cached state and tells the listeners that the subscriber list changed. */
  #changed(): void {
    this.#version++;
    this.#state = undefined;
    for (const listener of this.#listeners) listener();
  }
}
