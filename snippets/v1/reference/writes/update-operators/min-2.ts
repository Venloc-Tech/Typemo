$min?: { [P in OrderablePaths<T>]?: CompareOf<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>
