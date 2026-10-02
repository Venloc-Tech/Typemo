$pull?: { [P in ArrayPaths<T>]?: PullOperand<NonNullable<ElementAt<T, P>>> } & LooseEntries<T, Loose>
