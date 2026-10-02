type PostResult<E, T> = E extends "document.save" | "document.validate" | "document.init"
  ? T
  : E extends "document.deleteOne"
    ? DeleteResult
    : E extends "query.deleteOne" | "query.deleteMany"
      ? DeleteResult | Extract<BulkOperationResult<IdOf<T>>, { readonly deletedCount: null }>
      : E extends "document.updateOne"
        ? UpdateResult<IdOf<T>>
        : E extends "query.updateOne" | "query.updateMany" | "query.replaceOne"
          ? UpdateResult<IdOf<T>> | Extract<BulkOperationResult<IdOf<T>>, { readonly matchedCount: null }>
          : E extends "query.countDocuments" | "query.estimatedDocumentCount"
            ? number
            : E extends "query.find" | "query.distinct" | "model.insertMany" | "aggregate"
              ? readonly unknown[]
              : E extends "model.bulkWrite"
                ? BulkWriteResult<IdOf<T>>
                : unknown;
