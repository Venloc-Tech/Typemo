interface OpenTelemetryOptions {
  readonly tracerProvider?: TracerProvider;
  readonly meterProvider?: MeterProvider;
  readonly commandSpans?: boolean;
  readonly stepSpans?: boolean;
  readonly poolMetrics?: boolean;
  readonly sensitive?: SubscriberSensitive;
  readonly includeTenant?: boolean;
}
