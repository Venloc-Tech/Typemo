class ValidateBodyPipe<T extends object> implements PipeTransform<unknown, Promise<CreateInput<T>>> {
  constructor(model: Model<T>, options?: ValidateBodyOptions<T>);
  static for<T extends object>(entity: EntityClass<T>, options?: ValidateBodyOptions<T>, target?: FeatureTarget): Type<ValidateBodyPipe<T>>;
  transform(value: unknown, metadata?: ArgumentMetadata<unknown>): Promise<CreateInput<T>>;
}

interface ValidateBodyOptions<T> {
  readonly pick?: readonly (DataKeys<T> | "_id")[];
  readonly omit?: readonly (DataKeys<T> | "_id")[];
  readonly partial?: boolean;
  readonly dropUnknown?: boolean;
}
