class ParseIdPipe<T extends object> implements PipeTransform<unknown, IdOf<T>> {
  constructor(model: Model<T>);
  static for<T extends object>(entity: EntityClass<T>, target?: FeatureTarget): Type<ParseIdPipe<T>>;
  transform(value: unknown, metadata?: ArgumentMetadata<unknown>): IdOf<T>;
}
