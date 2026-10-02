type WriteValue<T, P extends string> = T extends unknown
  ? P extends `${infer H}.${infer R}`
    ? H extends DataKeys<T>
      ? WriteStep<NonNullable<T[H]>, R>
      : never
    : P extends DataKeys<T>
      ? T[P]
      : never
  : never;
