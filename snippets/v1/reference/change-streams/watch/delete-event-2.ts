interface DeleteEvent<in out T, in out O = Record<never, never>> extends ChangeEventBase {
  readonly operationType: "delete";
  readonly documentKey: { readonly _id: IdOf<T> };
  readonly fullDocumentBeforeChange: PreImage<EventDoc<T, O>, O>;
}
