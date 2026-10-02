const Post: <const E extends HookEvent | readonly [HookEvent, ...HookEvent[]]>(
  events: E,
) => HookDecorator<E, "post">;
