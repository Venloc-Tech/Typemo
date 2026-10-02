interface CollectionEvent extends ChangeEventBase {
  readonly operationType:
    | "drop" | "rename" | "dropDatabase" | "invalidate"
    | "create" | "createIndexes" | "dropIndexes" | "modify"
    | "shardCollection" | "reshardCollection" | "refineCollectionShardKey";
  readonly to?: { readonly db: string; readonly coll: string };
}
