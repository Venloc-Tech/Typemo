type SkipResult<E, T> = E extends "query.find" | "model.insertMany"
  ? readonly Lean<T>[]
  : E extends "query.findOne" | "query.findOneAndUpdate" | "query.findOneAndReplace" | "query.findOneAndDelete"
    ? Lean<T> | null
    : E extends "query.countDocuments" | "query.estimatedDocumentCount"
      ? number
      : E extends "query.distinct" | "aggregate"
        ? readonly unknown[]
        : E extends "query.updateOne" | "query.updateMany" | "query.replaceOne"
          ? UpdateResult<IdOf<T>>
          : E extends "query.deleteOne" | "query.deleteMany"
            ? DeleteResult
            : E extends "model.bulkWrite"
              ? BulkWriteResult<IdOf<T>>
              : never;
