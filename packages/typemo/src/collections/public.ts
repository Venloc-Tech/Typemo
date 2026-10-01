/* The public API of the collection mechanisms, re-exported by `src/index.ts` in one line. */
export { type CollectionDifference, CollectionOptionsError } from "./collection-errors.ts";
export {
  type CollectionInfo,
  CollectionManager,
  type EnsureCollectionOptions,
  type EnsureCollectionReport,
  type EnsureCollectionResult,
} from "./collection-manager.ts";
export {
  Materialized,
  type MaterializedInfo,
  type MaterializedRowCheck,
  type MaterializedWrite,
} from "./materialized.ts";
export {
  SyncAll,
  type SyncAllOptions,
  type SyncCollectionReport,
  type SyncReport,
  type SyncViewReport,
} from "./sync-all.ts";
export { SyncError, type SyncFailure } from "./sync-error.ts";
export { TypedView, type TypedViewDefinition, type ViewInfo } from "./typed-view.ts";
