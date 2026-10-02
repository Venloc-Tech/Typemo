$currentDate?: {
  [P in CurrentDatePaths<T>]?: NonNullable<WriteValue<T, P>> extends Date
    ? true | { readonly $type: "date" }
    : { readonly $type: "timestamp" };
} & LooseEntries<T, Loose>
