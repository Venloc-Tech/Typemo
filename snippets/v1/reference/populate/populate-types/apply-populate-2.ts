export type ApplyPopulate<T, Entries extends PopulationEntry, IsLean extends boolean> = [Entries] extends [never]
  ? T
  : T extends unknown
    ? Simplify<
        Omit<T, PopulatedKeys<T, Entries>> & {
          -readonly [K in keyof T as K extends PopulatedKeys<T, Entries>
            ? IsVirtualRef<T[K]> extends true
              ? never
              : K
            : never]: K extends string ? ApplyField<T, K, Entries, IsLean> : never;
        } & {
          -readonly [K in PopulatedKeys<T, Entries> as IsVirtualRef<T[K]> extends true ? K : never]-?: K extends string
            ? ApplyField<T, K, Entries, IsLean>
            : never;
        }
      >
    : never;
