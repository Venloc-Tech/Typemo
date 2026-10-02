$addToSet?: { [P in ArrayPaths<T>]?: AddToSetOperand<ElementAt<T, P>> } & LooseEntries<T, Loose>
