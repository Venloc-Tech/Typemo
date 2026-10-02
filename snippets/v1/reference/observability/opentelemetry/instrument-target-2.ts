interface InstrumentTarget {
  readonly instrument: (subscriber: InstrumentationSubscriber) => Subscription;
}
