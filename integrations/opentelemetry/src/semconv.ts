/*
 * OpenTelemetry database semantic convention names (semconv 1.43, stable + the incubating ones we need).
 * Copied, not imported: `@opentelemetry/semantic-conventions` recommends copying incubating names, and a
 * runtime dependency only for strings is not worth it. The "semantic convention names" test in
 * `test/opentelemetry.test.ts` checks them against the package.
 */

/**
 * Attribute and metric names of the OpenTelemetry database conventions
 * (https://opentelemetry.io/docs/specs/semconv/database/).
 */
export class SemConv {
  static readonly DB_SYSTEM_NAME = "db.system.name";
  static readonly DB_SYSTEM_NAME_VALUE_MONGODB = "mongodb";
  static readonly DB_NAMESPACE = "db.namespace";
  static readonly DB_COLLECTION_NAME = "db.collection.name";
  static readonly DB_OPERATION_NAME = "db.operation.name";
  static readonly DB_QUERY_SUMMARY = "db.query.summary";
  static readonly DB_QUERY_TEXT = "db.query.text";
  static readonly DB_RESPONSE_STATUS_CODE = "db.response.status_code";
  /** Incubating. */
  static readonly DB_RESPONSE_RETURNED_ROWS = "db.response.returned_rows";
  static readonly SERVER_ADDRESS = "server.address";
  static readonly SERVER_PORT = "server.port";
  static readonly ERROR_TYPE = "error.type";
  static readonly METRIC_DB_CLIENT_OPERATION_DURATION = "db.client.operation.duration";
  /** Incubating. */
  static readonly METRIC_DB_CLIENT_CONNECTION_COUNT = "db.client.connection.count";
  /** Incubating. */
  static readonly METRIC_DB_CLIENT_CONNECTION_TIMEOUTS = "db.client.connection.timeouts";
  /** Incubating. */
  static readonly METRIC_DB_CLIENT_CONNECTION_PENDING_REQUESTS = "db.client.connection.pending_requests";
  /** Incubating. */
  static readonly METRIC_DB_CLIENT_CONNECTION_MAX = "db.client.connection.max";
  /** Incubating. */
  static readonly METRIC_DB_CLIENT_CONNECTION_IDLE_MIN = "db.client.connection.idle.min";
  /** Incubating. */
  static readonly METRIC_DB_CLIENT_CONNECTION_CREATE_TIME = "db.client.connection.create_time";
  /** Incubating. */
  static readonly METRIC_DB_CLIENT_CONNECTION_WAIT_TIME = "db.client.connection.wait_time";
  /** Incubating. */
  static readonly METRIC_DB_CLIENT_CONNECTION_USE_TIME = "db.client.connection.use_time";
  /** Incubating. */
  static readonly DB_CLIENT_CONNECTION_POOL_NAME = "db.client.connection.pool.name";
  /** Incubating. */
  static readonly DB_CLIENT_CONNECTION_STATE = "db.client.connection.state";
  /** Incubating. */
  static readonly DB_CLIENT_CONNECTION_STATE_VALUE_IDLE = "idle";
  /** Incubating. */
  static readonly DB_CLIENT_CONNECTION_STATE_VALUE_USED = "used";
  /** The explicit bucket boundaries of `db.client.operation.duration` (seconds, from the conventions). */
  static readonly DURATION_BUCKETS: readonly number[] = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10];
}
