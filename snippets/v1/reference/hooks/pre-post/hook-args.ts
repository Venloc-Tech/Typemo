type HookArgs<P extends HookPhase, E = HookEvent, T = unknown> = P extends "pre"
  ? []
  : P extends "post"
    ? [result: PostResult<EventsOf<E>, T>]
    : [error: unknown];
