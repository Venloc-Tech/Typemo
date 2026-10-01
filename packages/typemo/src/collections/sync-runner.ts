import type { Connection } from "../connection/connection.ts";
import { ConnectionInternals } from "../connection/connection-internals.ts";
import { ErrorTranslator } from "../errors/error-translator.ts";
import { TypemoError } from "../errors/typemo-error.ts";
import { type IndexSyncResult, ModelIndexes, type SearchIndexSyncResult } from "../model/model-indexes.ts";
import { ModelInternals } from "../model/model-internals.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import { CollectionGuard } from "./collection-guard.ts";
import { CollectionManager, type EnsureCollectionReport } from "./collection-manager.ts";
import type { SyncAllOptions, SyncCollectionReport, SyncReport, SyncViewReport } from "./sync-all.ts";
import { SyncError } from "./sync-error.ts";
import { TypedView } from "./typed-view.ts";

/*
 * The work of `syncAll` (mode `sync`) and `connection.init()` (mode `init`); see `SyncAll` for what it does.
 * The mode is not part of the public API: `syncAll` and `init` are the two ways to call it.
 */

/**
 * @internal How `SyncAll.run` changes the server: `sync` — everything (`syncAll`); `init` — only creates what is
 * missing (`connection.init()`): collections, indexes, search indexes and views; nothing is dropped
 * or changed, a difference is a failure in the report.
 *
 * @example
 * ```ts
 * const mode: SyncMode = "init";
 * ```
 */
export type SyncMode = "sync" | "init";

/**
 * Turns any thrown value into a `TypemoError`, so the report holds one error type.
 *
 * @param error - The caught value.
 * @returns The classified Typemo error, or a new `TypemoError` with `error` as its `cause`.
 */
const typemo = (error: unknown): TypemoError => {
  const wrapped = ErrorTranslator.wrap(error);
  return wrapped instanceof TypemoError ? wrapped : new TypemoError(String(error), { cause: error });
};

/**
 * Counts the indexes an index sync result would create or drop.
 *
 * @param result - An index or search-index sync result.
 * @returns The number of indexes to create plus the number to drop.
 */
const indexChanges = (result: { readonly toCreate: readonly unknown[]; readonly toDrop: readonly unknown[] }) =>
  result.toCreate.length + result.toDrop.length;

/** @internal The runner of `syncAll` and `connection.init()`. */
export class SyncRunner {
  /**
   * The root schemas of the connection's collections, once each (views excluded).
   *
   * @param connection - The connection whose models are inspected.
   * @returns One root schema per collection.
   */
  static collections(connection: Connection): readonly CompiledSchema[] {
    const roots = new Map<string, CompiledSchema>();
    for (const model of connection.models) {
      const root = ModelInternals.schema(model).root;
      if (TypedView.isView(connection, root.collection)) continue;
      if (!roots.has(root.collection)) roots.set(root.collection, root);
    }
    return [...roots.values()];
  }

  /**
   * Brings every collection (options, indexes, search indexes) and every view of the connection in line
   * with the models. A failing step does not stop the others; failures are collected in the report. `dryRun`
   * holds in both modes: nothing is created, changed or dropped, the report says what would be.
   *
   * @param connection - The connection to sync.
   * @param options - `dryRun` and `update`.
   * @param mode - `sync` (default) does everything, `init` only creates what is missing.
   * @returns The per-collection and per-view report (nothing failed).
   * @throws {SyncError} When some step failed (after every step ran); the report is in the error.
   */
  static async run(connection: Connection, options: SyncAllOptions = {}, mode: SyncMode = "sync"): Promise<SyncReport> {
    await connection.ready();
    const init = mode === "init";
    const db = ConnectionInternals.environment(connection).driver.db;
    const dryRun = options.dryRun === true;
    const collections: SyncCollectionReport[] = [];
    const created: string[] = [];
    let changed = false;
    for (const schema of SyncRunner.collections(connection)) {
      const errors: TypemoError[] = [];
      const report: {
        collection: string;
        model: string;
        options?: EnsureCollectionReport;
        indexes?: IndexSyncResult;
        searchIndexes?: SearchIndexSyncResult;
      } = { collection: schema.collection, model: schema.name };
      if (schema.options.autoCreate !== false) {
        try {
          report.options = await CollectionManager.ensure(db, schema, {
            dryRun,
            ...(options.update === undefined ? {} : { update: options.update }),
          });
          if (report.options.result !== "unchanged") changed = true;
          if (report.options.result === "created") created.push(`collection ${schema.collection}`);
        } catch (error) {
          errors.push(typemo(error));
        }
      }
      if (schema.options.autoIndex !== false) {
        const nothingToCreate = schema.indexes.length === 0 && schema.searchIndexes.length === 0;
        const collection = db.collection(schema.collection);
        try {
          /* An index would create a missing collection without its creation-only options (see CollectionGuard).
           * A schema that says autoCreate: false and has no index to create touches nothing, so a missing collection
           * is not an error for it: the collection is created elsewhere. */
          if (!dryRun && (schema.options.autoCreate !== false || !nothingToCreate))
            await CollectionGuard.beforeIndexes(db, schema, init ? "connection.init" : "syncAll");
          report.indexes = init
            ? await ModelIndexes.ensure(schema, collection, db, dryRun)
            : await ModelIndexes.sync(schema, collection, dryRun, db);
          if (indexChanges(report.indexes) + report.indexes.toModify.length > 0) changed = true;
          for (const name of report.indexes.toCreate) created.push(`index ${schema.collection}.${name}`);
        } catch (error) {
          errors.push(typemo(error));
        }
        if (schema.searchIndexes.length > 0) {
          try {
            report.searchIndexes = init
              ? await ModelIndexes.ensureSearch(schema, collection, dryRun)
              : await ModelIndexes.syncSearch(schema, collection, dryRun);
            if (indexChanges(report.searchIndexes) + report.searchIndexes.toUpdate.length > 0) changed = true;
            for (const name of report.searchIndexes.toCreate) created.push(`search index ${schema.collection}.${name}`);
          } catch (error) {
            errors.push(typemo(error));
          }
        }
      }
      collections.push(Object.freeze({ ...report, errors: Object.freeze(errors) }));
    }
    const views: SyncViewReport[] = [];
    for (const view of TypedView.of(connection)) {
      const errors: TypemoError[] = [];
      let result: EnsureCollectionReport | undefined;
      try {
        result = await view.ensure({ dryRun, ...(options.update === undefined ? {} : { update: options.update }) });
        if (result.result !== "unchanged") changed = true;
        if (result.result === "created") created.push(`view ${view.definition.name}`);
      } catch (error) {
        errors.push(typemo(error));
      }
      views.push(
        Object.freeze({
          view: view.definition.name,
          ...(result === undefined ? {} : { result }),
          errors: Object.freeze(errors),
        }),
      );
    }
    const failed = [...collections, ...views].some((entry) => entry.errors.length > 0);
    const report: SyncReport = Object.freeze({
      collections: Object.freeze(collections),
      views: Object.freeze(views),
      /* init() only ever creates what is missing: once that succeeded the database matches the models, so a
       * finished (not dry-run) init is in sync; what it did is listed in created. */
      inSync: !failed && (!changed || (init && !dryRun)),
      failed,
      created: Object.freeze(created),
    });
    if (failed) throw new SyncError(init ? "connection.init" : "syncAll", connection.name, report);
    return report;
  }
}
