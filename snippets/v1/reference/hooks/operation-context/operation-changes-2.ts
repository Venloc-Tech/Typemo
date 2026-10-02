interface OperationChanges<T> {
  readonly where?: Filter<T>;
  readonly update?: Update<T>;
  readonly select?: Projection<T>;
  readonly sort?: Sort<T>;
  readonly stages?: readonly PipelineStage[];
}

type ChangeKeys<E> = E extends "query.find" | "query.findOne" | "query.findOneAndReplace" | "query.findOneAndDelete"
  ? "where" | "select" | "sort"
  : E extends "query.findOneAndUpdate"
    ? "where" | "update" | "select" | "sort"
    : E extends "query.updateOne" | "query.updateMany"
      ? "where" | "update"
      : E extends "query.countDocuments" | "query.distinct" | "query.replaceOne" | "query.deleteOne" | "query.deleteMany"
        ? "where"
        : E extends "aggregate"
          ? "stages"
          : never;

type OperationChange<T, E> = Pick<OperationChanges<T>, ChangeKeys<E>>;
