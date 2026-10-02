$unset?: { [P in UnsetPaths<T>]?: "" | 1 | true } & LooseEntries<T, Loose>
