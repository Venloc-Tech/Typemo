import type { InstrumentationEvent } from "@venloc/typemo";
// ---cut---
const describe = (event: InstrumentationEvent): string => {
  switch (event.type) {
    case "operation.start":
      return `${event.operation} начата`;
    case "operation.end":
      return `${event.operation}: ${event.durationMS} мс`;
    case "operation.error":
      return `${event.operation} упала на шаге ${event.failedStep}`;
    default:
      return event.type;
  }
};
