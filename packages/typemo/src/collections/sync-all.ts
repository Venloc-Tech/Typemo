import type { Connection } from "../connection/connection.ts";
import type { TypemoError } from "../errors/typemo-error.ts";
import type { IndexSyncResult, SearchIndexSyncResult } from "../model/model-indexes.ts";
import type { SchemaInfo } from "../schema/compiler/compiled-schema.ts";
import type { EnsureCollectionReport } from "./collection-manager.ts";
import { SyncRunner } from "./sync-runner.ts";

/*
 * `syncAll` brings the database in line with the models and views of a connection in one call: for every
 * collection its options (`ensureCollection`) and indexes (`syncIndexes`, search indexes when the schema
 * declares some), then every view (`ensure`). A deploy step or a start-up script needs exactly this;
 * `dryRun` reports and writes nothing.
 * EVERY step of every model runs even if another failed: failures are collected per collection, and a call
 * with any failure throws one `SyncError` that lists them and holds the whole report.
 * Discriminator models share their root's collection: it is synced once, by the root schema (whose
 * indexes include the discriminators' scoped ones). `autoCreate: false` / `autoIndex: false` on a schema
 * leave its collection / indexes out.
 */

/**
 * Options of `syncAll`.
 *
 * @example
 * ```ts
 * const options: SyncAllOptions = { dryRun: true, update: true };
 * ```
 */
export interface SyncAllOptions {
  /** Only report what would change; nothing is written. */
  readonly dryRun?: boolean;
  /**
   * Apply what `collMod` can change (collection options, a view's pipeline); without it such a difference
   * is an error in the report.
   */
  readonly update?: boolean;
}

/**
 * What `syncAll` found or did for one collection.
 *
 * @example
 * ```ts
 * const report = await connection.syncAll({ dryRun: true });
 * const users: SyncCollectionReport | undefined = report.collections.find((c) => c.collection === "users");
 * ```
 */
export interface SyncCollectionReport {
  /** The collection name. */
  readonly collection: string;
  /** The root model class of the collection. */
  readonly model: string;
  /** `undefined` when skipped (`autoCreate: false`) or failed (see `errors`). */
  readonly options?: EnsureCollectionReport;
  /** `undefined` when skipped (`autoIndex: false`) or failed. */
  readonly indexes?: IndexSyncResult;
  /** `undefined` when the schema declares no search index, or failed. */
  readonly searchIndexes?: SearchIndexSyncResult;
  /** Every failure of this collection (the other steps still ran); a failure makes the call throw `SyncError`. */
  readonly errors: readonly TypemoError[];
}

/**
 * What `syncAll` found or did for one view.
 *
 * @example
 * ```ts
 * const report = await connection.syncAll();
 * const view: SyncViewReport | undefined = report.views[0];
 * ```
 */
export interface SyncViewReport {
  /** The view name. */
  readonly view: string;
  /** What `ensure` found or did; `undefined` when it failed (see `errors`). */
  readonly result?: EnsureCollectionReport;
  /** Every failure of this view. */
  readonly errors: readonly TypemoError[];
}

/**
 * The outcome of `syncAll`.
 *
 * @example
 * ```ts
 * const report: SyncReport = await connection.syncAll({ dryRun: true });
 * if (!report.inSync) console.log(report.created);
 * ```
 */
export interface SyncReport {
  /** One entry per synced collection. */
  readonly collections: readonly SyncCollectionReport[];
  /** One entry per synced view. */
  readonly views: readonly SyncViewReport[];
  /**
   * `true` when nothing failed and the database matches the models: for `syncAll` nothing differed; for
   * `connection.init()` also after it created what was missing (see `created`). A `dryRun` that finds something
   * to do is never in sync.
   */
  readonly inSync: boolean;
  /**
   * What was created — or, with `dryRun`, would be — in order: `"collection users"`, `"index users.email_1"`,
   * `"search index users.default"`, `"view active_users"`. Empty when nothing was missing.
   */
  readonly created: readonly string[];
  /**
   * `true` when some step failed. A returned report is always `false`: a failure throws `SyncError`, whose
   * `report` has it `true`.
   */
  readonly failed: boolean;
}

/** `syncAll` over a connection. */
export class SyncAll {
  /**
   * The root schemas of the connection's collections, once each (views excluded).
   *
   * @param connection - The connection whose models are inspected.
   * @returns One root schema per collection.
   */
  static collections(connection: Connection): readonly SchemaInfo[] {
    return SyncRunner.collections(connection);
  }

  /**
   * Brings every collection (options, indexes, search indexes) and every view of the connection in line
   * with the models. A failing step does not stop the others; the failures are collected and thrown together
   * as one `SyncError`. With `dryRun` nothing at all is written — no collection, no index, no view: the report
   * says what would be done.
   *
   * @param connection - The connection to sync.
   * @param options - `dryRun` and `update`.
   * @returns The per-collection and per-view report.
   * @throws {SyncError} When some step failed; its `report` is the full report.
   */
  static run(connection: Connection, options: SyncAllOptions = {}): Promise<SyncReport> {
    return SyncRunner.run(connection, options, "sync");
  }
}
