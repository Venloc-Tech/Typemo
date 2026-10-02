const Pre: <const E extends HookEvent | readonly [HookEvent, ...HookEvent[]]>(
  events: E,
) => HookDecorator<E, "pre">;

type HookDecorator<E, P extends HookPhase> = <T extends object, K extends string, M extends HookMethod<E, T, P>>(
  target: T,
  key: K,
  descriptor: TypedPropertyDescriptor<M> & HookCheck<E, T, M, P>,
) => void;

type HookMethod<E, T, P extends HookPhase> = (this: HookThisOf<E, T>, ...args: HookArgs<P, E, T>) => unknown;
