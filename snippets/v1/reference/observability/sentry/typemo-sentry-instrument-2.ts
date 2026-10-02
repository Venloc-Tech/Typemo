class TypemoSentry {
  static instrument(target: InstrumentationTarget, options?: SentryInstrumentationOptions): Subscription;
}

interface InstrumentationTarget {
  readonly instrument: (subscriber: InstrumentationSubscriber) => Subscription;
}
