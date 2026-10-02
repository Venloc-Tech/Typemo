$set?: SetFields<T, false, Loose>
// SetFields<T>: { [P in WritePaths<T>]?: InputOf<WriteValue<T, P>> }, without "_id"
