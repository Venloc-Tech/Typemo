type Update<in out T, in out Loose extends boolean = true> = {
  $set?: SetFields<T, false, Loose>;
  $setOnInsert?: SetFields<T, true, Loose>;
  $unset?: { [P in UnsetPaths<T>]?: "" | 1 | true } & LooseEntries<T, Loose>;
  $inc?: { [P in NumericPaths<T>]?: NumericOperand<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>;
  $mul?: { [P in NumericPaths<T>]?: NumericOperand<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>;
  $min?: { [P in OrderablePaths<T>]?: CompareOf<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>;
  $max?: { [P in OrderablePaths<T>]?: CompareOf<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>;
  $currentDate?: { /* Date: true | { $type: "date" }, Timestamp: { $type: "timestamp" } */ } & LooseEntries<T, Loose>;
  $rename?: { [P in RenamePaths<T>]?: RenameTarget<T, P> };
  $push?: { [P in ArrayPaths<T>]?: PushOperand<ElementAt<T, P>> } & LooseEntries<T, Loose>;
  $addToSet?: { [P in ArrayPaths<T>]?: AddToSetOperand<ElementAt<T, P>> } & LooseEntries<T, Loose>;
  $pull?: { [P in ArrayPaths<T>]?: PullOperand<NonNullable<ElementAt<T, P>>> } & LooseEntries<T, Loose>;
  $pullAll?: { [P in ArrayPaths<T>]?: readonly InputOf<ElementAt<T, P>>[] } & LooseEntries<T, Loose>;
  $pop?: { [P in ArrayPaths<T>]?: 1 | -1 } & LooseEntries<T, Loose>;
  $bit?: { [P in IntegerPaths<T>]?: BitOperand<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>;
};
