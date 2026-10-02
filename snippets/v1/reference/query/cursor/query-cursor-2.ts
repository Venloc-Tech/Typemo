interface CursorSource<T> extends AsyncIterable<T, void, undefined> {
  readonly close?: () => Promise<void>;
}

interface EachAsyncOptions {
  readonly parallel?: number;
  readonly continueOnError?: boolean;
}

interface EachAsyncBatchOptions extends EachAsyncOptions {
  readonly batchSize: number;
}

interface QueryCursor<T> extends AsyncIterable<T, void, undefined> {
  next(): Promise<T | null>;
  toArray(): Promise<T[]>;
  close(): Promise<void>;
  eachAsync(fn: (docs: T[], batchIndex: number) => unknown, options: EachAsyncBatchOptions): Promise<void>;
  eachAsync(fn: (doc: T, index: number) => unknown, options?: EachAsyncOptions): Promise<void>;
  map<U>(fn: (doc: T) => U): QueryCursor<U>;
}
