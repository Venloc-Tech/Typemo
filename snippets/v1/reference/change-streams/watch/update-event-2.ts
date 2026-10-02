interface UpdateEvent<in out T, in out O = Record<never, never>> extends ChangeEventBase {
  readonly operationType: "update";
  readonly documentKey: { readonly _id: IdOf<T> };
  readonly updateDescription: UpdateDescription;
  readonly fullDocument: PostImage<EventDoc<T, O>, O>;
  readonly fullDocumentBeforeChange: PreImage<EventDoc<T, O>, O>;
}
