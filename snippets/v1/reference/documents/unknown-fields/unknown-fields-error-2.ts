class UnknownFieldsError extends TypemoError {
  readonly fields: readonly UnknownFields[];
  constructor(fields: readonly UnknownFields[]);
}
