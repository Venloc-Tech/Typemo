type HookThis<E, T> = E extends DocumentHookEvent
  ? HydratedDoc<T> | Subdocument<T>
  : E extends OperationHookEvent
    ? OperationHookContext<T, E>
    : never;

type HookThisOf<E, T> = E extends readonly (infer U)[] ? HookThis<U, T> : HookThis<E, T>;
