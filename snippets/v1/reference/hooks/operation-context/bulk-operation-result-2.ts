type BulkOperationResult<Id = unknown> =
  | {
      readonly acknowledged: boolean;
      readonly matchedCount: null;
      readonly modifiedCount: null;
      readonly upsertedCount: number;
      readonly upsertedId: Id | null;
    }
  | {
      readonly acknowledged: boolean;
      readonly deletedCount: null;
    };
