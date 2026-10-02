interface InstrumentationSubscriber {
  readonly handle: (event: InstrumentationEvent) => void;
  readonly sensitive?: SubscriberSensitive;
  readonly driverCommands?: boolean;
  readonly poolEvents?: boolean;
  readonly steps?: boolean;
  readonly includeTenant?: boolean;
  readonly wrap?: (operation: OperationInfo, run: () => Promise<void>) => Promise<unknown>;
}
