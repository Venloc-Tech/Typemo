import type { Attributes, Counter, Histogram, Meter, UpDownCounter } from "@opentelemetry/api";
import type { PoolEvent } from "@venloc/typemo";
import { SemConv } from "./semconv.ts";

/**
 * The fields of the driver's CMAP event objects these metrics read (no user data in them).
 *
 * @example
 * ```ts
 * const fields: CmapFields = { connectionId: 3, durationMS: 12, options: { maxPoolSize: 100, minPoolSize: 0 } };
 * ```
 */
interface CmapFields {
  /** The driver's connection id. */
  readonly connectionId?: unknown;
  /** Duration of the step the event reports, in milliseconds. */
  readonly durationMS?: unknown;
  /** Why a check-out failed (`timeout`, ...). */
  readonly reason?: unknown;
  /** The pool options, present on `connectionPoolCreated`. */
  readonly options?: { readonly maxPoolSize?: unknown; readonly minPoolSize?: unknown };
}

/**
 * Converts milliseconds to seconds, the unit of the OpenTelemetry duration metrics.
 *
 * @param value - A duration in milliseconds, or anything else.
 * @returns Seconds, or `undefined` when `value` is not a number.
 */
const seconds = (value: unknown): number | undefined => (typeof value === "number" ? value / 1000 : undefined);

/**
 * The connection pool metrics of one adapter registration: the database client conventions (semconv 1.43,
 * incubating) that the driver's CMAP events give: connection count by state, pending requests, timeouts,
 * the configured maximum and minimum idle, the create / wait / use times. `db.client.connection.idle.max`
 * has no MongoDB counterpart (the pool has no idle maximum) and is not reported. `max` and `idle.min` come
 * from `connectionPoolCreated`: a pool created before the subscription is not counted there.
 */
export class PoolMetrics {
  readonly #count: UpDownCounter;
  readonly #pending: UpDownCounter;
  readonly #timeouts: Counter;
  readonly #max: UpDownCounter;
  readonly #idleMin: UpDownCounter;
  readonly #createTime: Histogram;
  readonly #waitTime: Histogram;
  readonly #useTime: Histogram;
  /** Checked-out connections (`address#connectionId`) → the check-out time (ms), for `use_time`. */
  readonly #checkedOut = new Map<string, number>();
  /** The limits reported per pool (address) when it was created. */
  readonly #limits = new Map<string, { readonly max: number; readonly min: number }>();

  /**
   * @param meter - The OpenTelemetry meter the instruments are created on.
   */
  constructor(meter: Meter) {
    this.#count = meter.createUpDownCounter(SemConv.METRIC_DB_CLIENT_CONNECTION_COUNT, {
      unit: "{connection}",
      description: "The number of connections that are currently in state described by the state attribute.",
    });
    this.#pending = meter.createUpDownCounter(SemConv.METRIC_DB_CLIENT_CONNECTION_PENDING_REQUESTS, {
      unit: "{request}",
      description: "The number of current pending requests for an open connection.",
    });
    this.#timeouts = meter.createCounter(SemConv.METRIC_DB_CLIENT_CONNECTION_TIMEOUTS, {
      unit: "{timeout}",
      description: "The number of connection timeouts that have occurred trying to obtain a connection from the pool.",
    });
    this.#max = meter.createUpDownCounter(SemConv.METRIC_DB_CLIENT_CONNECTION_MAX, {
      unit: "{connection}",
      description: "The maximum number of open connections allowed.",
    });
    this.#idleMin = meter.createUpDownCounter(SemConv.METRIC_DB_CLIENT_CONNECTION_IDLE_MIN, {
      unit: "{connection}",
      description: "The minimum number of idle open connections allowed.",
    });
    this.#createTime = meter.createHistogram(SemConv.METRIC_DB_CLIENT_CONNECTION_CREATE_TIME, {
      unit: "s",
      description: "The time it took to create a new connection.",
    });
    this.#waitTime = meter.createHistogram(SemConv.METRIC_DB_CLIENT_CONNECTION_WAIT_TIME, {
      unit: "s",
      description: "The time it took to obtain an open connection from the pool.",
    });
    this.#useTime = meter.createHistogram(SemConv.METRIC_DB_CLIENT_CONNECTION_USE_TIME, {
      unit: "s",
      description: "The time between borrowing a connection and returning it to the pool.",
    });
  }

  /**
   * Updates the metrics for one pool event.
   *
   * @param event - A driver CMAP event wrapped by the core.
   */
  record(event: PoolEvent): void {
    const fields = (event.event ?? {}) as CmapFields;
    const pool: Attributes = { [SemConv.DB_CLIENT_CONNECTION_POOL_NAME]: event.address };
    const idle = { ...pool, [SemConv.DB_CLIENT_CONNECTION_STATE]: SemConv.DB_CLIENT_CONNECTION_STATE_VALUE_IDLE };
    const used = { ...pool, [SemConv.DB_CLIENT_CONNECTION_STATE]: SemConv.DB_CLIENT_CONNECTION_STATE_VALUE_USED };
    const key = `${event.address}#${String(fields.connectionId)}`;
    switch (event.name) {
      case "connectionPoolCreated":
        this.#open(event.address, fields, pool);
        break;
      case "connectionPoolClosed":
        this.#close(event.address, pool);
        break;
      case "connectionCreated":
        this.#count.add(1, idle);
        break;
      case "connectionReady":
        this.#time(this.#createTime, fields.durationMS, pool);
        break;
      case "connectionCheckOutStarted":
        this.#pending.add(1, pool);
        break;
      case "connectionCheckedOut":
        this.#pending.add(-1, pool);
        this.#time(this.#waitTime, fields.durationMS, pool);
        this.#count.add(-1, idle);
        this.#count.add(1, used);
        this.#checkedOut.set(key, event.timestamp);
        break;
      case "connectionCheckOutFailed":
        this.#pending.add(-1, pool);
        this.#time(this.#waitTime, fields.durationMS, pool);
        if (fields.reason === "timeout") this.#timeouts.add(1, pool);
        break;
      case "connectionCheckedIn": {
        this.#count.add(-1, used);
        this.#count.add(1, idle);
        const since = this.#checkedOut.get(key);
        this.#checkedOut.delete(key);
        if (since !== undefined) this.#useTime.record(Math.max(0, event.timestamp - since) / 1000, pool);
        break;
      }
      case "connectionClosed":
        /* The driver closes idle connections (or checked-in ones on a clear): counted as idle. */
        this.#count.add(-1, idle);
        this.#checkedOut.delete(key);
        break;
      default:
        break;
    }
  }

  /**
   * Reports the limits of a created pool.
   *
   * @param address - The pool address.
   * @param fields - The `connectionPoolCreated` event fields.
   * @param pool - The pool attributes.
   */
  #open(address: string, fields: CmapFields, pool: Attributes): void {
    const max = fields.options?.maxPoolSize;
    const min = fields.options?.minPoolSize;
    /* `maxPoolSize: 0` is "no limit": no maximum to report. */
    const limits = { max: typeof max === "number" && max > 0 ? max : 0, min: typeof min === "number" ? min : 0 };
    this.#limits.set(address, limits);
    if (limits.max > 0) this.#max.add(limits.max, pool);
    if (limits.min > 0) this.#idleMin.add(limits.min, pool);
  }

  /**
   * `connectionPoolClosed` carries no options: the limits taken when the pool was created are taken back.
   *
   * @param address - The pool address.
   * @param pool - The pool attributes.
   */
  #close(address: string, pool: Attributes): void {
    const limits = this.#limits.get(address);
    if (limits === undefined) return;
    this.#limits.delete(address);
    if (limits.max > 0) this.#max.add(-limits.max, pool);
    if (limits.min > 0) this.#idleMin.add(-limits.min, pool);
  }

  /**
   * Records a duration in seconds when it is a number.
   *
   * @param histogram - The target histogram.
   * @param durationMS - The duration in milliseconds, as read from the event.
   * @param pool - The pool attributes.
   */
  #time(histogram: Histogram, durationMS: unknown, pool: Attributes): void {
    const value = seconds(durationMS);
    if (value !== undefined) histogram.record(value, pool);
  }
}
