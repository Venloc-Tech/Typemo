const EntityWithId: EntityWithIdFactory

interface EntityWithIdFactory {
  <const S extends IdSpec>(type: () => S): IdBase<SpecValue<S>, false>;
  <const S extends IdSpec>(
    type: () => S,
    options: { readonly default: () => SpecValue<S> },
  ): IdBase<SpecValue<S>, true>;
}

type IdBase<Id, HasDefault extends boolean> = abstract new () => {
  _id: HasDefault extends true ? Defaulted<Immutable<Id>> : Immutable<Id>;
};

interface EntityIdOptions<Id> {
  readonly default?: () => Id;
}

type IdSpec =
  | StringConstructor | NumberConstructor | BigIntConstructor | DateConstructor
  | typeof UUID | BsonClass<"ObjectId"> | BsonClass<"Int32">
  | BsonClass<"Double"> | BsonClass<"Decimal128">;
