const Timestamped: <B extends EntityClass>(base: B) => Mixed<B, TimestampFields>

interface TimestampFields {
  createdAt: Defaulted<Immutable<Date>>;
  updatedAt: Defaulted<Date>;
}
