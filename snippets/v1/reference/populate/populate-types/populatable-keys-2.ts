export type PopulatableKeys<T> = {
  [K in keyof T & string]-?: IsVirtualRef<T[K]> extends true
    ? K
    : K extends DataKeys<T>
      ? [RefModel<T[K]>] extends [never]
        ? NonNullable<T[K]> extends ReadonlyMap<string, infer E>
          ? [RefModel<E>] extends [never]
            ? never
            : K
          : never
        : K
      : never;
}[keyof T & string];
