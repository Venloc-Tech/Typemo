interface InsertEvent<in out T, in out O = Record<never, never>> extends ChangeEventBase {
  readonly operationType: "insert";
  readonly documentKey: { readonly _id: IdOf<T> };
  readonly fullDocument: EventDoc<T, O>;
}
