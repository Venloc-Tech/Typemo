keysetPage<F extends Filter<T, true> = Record<never, never>, const L extends boolean = false>(
  options: KeysetPageOptions<T, F, L>,
): Promise<KeysetPage<ResultDoc<T, undefined, never, L, NoNarrowing, never>>>

interface KeysetPageOptions<T, F, L extends boolean> {
  readonly filter?: F & NoInfer<FilterCheck<T, F>>;
  readonly sort: KeysetSort<T>;
  readonly limit: number;
  readonly after?: string | null;
  readonly lean?: L;
  readonly session?: ClientSession | null;
}

interface KeysetPage<Row> {
  readonly items: Row[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}
