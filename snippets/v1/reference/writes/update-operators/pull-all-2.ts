$pullAll?: { [P in ArrayPaths<T>]?: readonly InputOf<ElementAt<T, P>>[] } & LooseEntries<T, Loose>
