class Contract {
  static check<Expected>(): <V>(
    value: V & (ContractCheck<V, Expected> extends true ? unknown : ContractCheck<V, Expected>),
  ) => Expected
}
