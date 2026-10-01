/*
 * The public API of cursors, re-exported by `src/index.ts` in one line: the cursor class, its interface
 * `QueryCursor`, the source it reads (`CursorSource`) and the `eachAsync` options.
 */
export {
  type CursorSource,
  type EachAsyncBatchOptions,
  type EachAsyncOptions,
  type QueryCursor,
  TypedCursor,
} from "./typed-cursor.ts";
