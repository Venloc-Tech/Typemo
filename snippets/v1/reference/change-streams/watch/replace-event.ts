interface ReplaceEvent<in out T, in out O = Record<never, never>> extends ChangeEventBase {
  readonly operationType: "replace";
  readonly documentKey: { readonly _id: IdOf<T> };
  readonly fullDocument: EventDoc<T, O>;
  readonly fullDocumentBeforeChange: PreImage<EventDoc<T, O>, O>;
}
