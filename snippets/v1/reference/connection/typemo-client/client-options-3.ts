type TypemoClientOptions = Omit<MongoClientOptions, "socketTimeoutMS" | "waitQueueTimeoutMS" | "wtimeoutMS"> & TypemoOwnOptions

interface TypemoOwnOptions {
  readonly readyTimeoutMS?: number;
  readonly name?: string;
  readonly dbName?: string;
  readonly keysetSecret?: string | Uint8Array | readonly (string | Uint8Array)[];
  readonly validateReads?: boolean | "development";
}
