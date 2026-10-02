interface SentryInstrumentationOptions {
  readonly captureErrors?: boolean;
  readonly breadcrumbs?: boolean;
  readonly sensitive?: SubscriberSensitive;
  readonly includeTenant?: boolean;
}
