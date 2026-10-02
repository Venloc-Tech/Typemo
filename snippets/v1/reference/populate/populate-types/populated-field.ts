export interface PopulatedField<Value, Original, Transformed extends boolean = false> {
  readonly [POPULATED]: readonly [Value, Original, Transformed];
}
