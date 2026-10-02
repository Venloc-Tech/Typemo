interface Subscription {
  readonly unsubscribe: () => void;
  readonly [Symbol.dispose]: () => void;
}
