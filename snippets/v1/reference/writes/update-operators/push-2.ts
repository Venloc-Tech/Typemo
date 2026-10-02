$push?: { [P in ArrayPaths<T>]?: PushOperand<ElementAt<T, P>> } & LooseEntries<T, Loose>

type PushOperand<E> =
  | InputOf<E>
  | {
      readonly $each: readonly InputOf<E>[];
      readonly $position?: number;
      readonly $slice?: number;
      readonly $sort?: PushSort<E>;
    };
