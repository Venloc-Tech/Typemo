type InstrumentationEvent =
  | OperationStartEvent
  | OperationEndEvent
  | OperationErrorEvent
  | StepEvent
  | CursorBatchEvent
  | TransactionEvent
  | DriverCommandEvent
  | PoolEvent
  | InstrumentationErrorEvent;

type InstrumentationEventType = InstrumentationEvent["type"];
