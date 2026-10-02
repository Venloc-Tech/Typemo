$inc?: { [P in NumericPaths<T>]?: NumericOperand<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>
