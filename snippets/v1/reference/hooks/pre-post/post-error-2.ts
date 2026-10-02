const PostError: <const E extends HookEvent | readonly [HookEvent, ...HookEvent[]]>(
  events: E,
) => HookDecorator<E, "postError">;
