type CreateInput<T> = InputFields<T, never>;

type InputFields<T, Omitted> = Simplify<
  {
    -readonly [K in keyof T as K extends Exclude<InputKeys<T, false>, Omitted> ? K : never]: InputOf<NoUndefined<T[K]>>;
  } & {
    -readonly [K in keyof T as K extends Exclude<InputKeys<T, true>, Omitted> ? K : never]?: InputOf<NoUndefined<T[K]>>;
  }
>;
