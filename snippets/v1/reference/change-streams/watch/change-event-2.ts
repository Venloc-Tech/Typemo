type ChangeEvent<T, O = Record<never, never>> =
  | InsertEvent<T, O>
  | UpdateEvent<T, O>
  | ReplaceEvent<T, O>
  | DeleteEvent<T, O>
  | CollectionEvent
