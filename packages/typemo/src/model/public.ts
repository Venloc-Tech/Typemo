/* The public API of the model, re-exported by `src/index.ts` in one line. */
export { AggregateQuery } from "./aggregate-query.ts";
export type { BulkWriteOperation, BulkWriteResult, BulkWriteResultOf } from "./bulk-write.ts";
export {
  type AggregateBuild,
  type AggregateResult,
  type AggregateRows,
  type BulkWriteOptions,
  type InsertManyOptions,
  type KeysetPageOptions,
  Model,
  type ModelAggregateOptions,
  type WatchBuilder,
  type WatchResult,
  type WatchRows,
  type WriteOptions,
} from "./model.ts";
export type {
  IndexDiff,
  IndexModification,
  IndexSyncResult,
  SearchIndexDiff,
  SearchIndexSyncResult,
} from "./model-indexes.ts";
export type { PlainReadOptions } from "./plain-reader.ts";
