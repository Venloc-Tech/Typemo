$bit?: { [P in IntegerPaths<T>]?: BitOperand<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>

type BitOperand<V> = { readonly and: V } | { readonly or: V } | { readonly xor: V };
