import type { InstrumentationEvent } from "@venloc/typemo";
// ---cut---
const describe = (event: InstrumentationEvent): string => {
  switch (event.type) {
    case "operation.start":
      return `${event.operation} started`;
    case "operation.end":
      return `${event.operation}: ${event.durationMS} ms`;
    case "operation.error":
      return `${event.operation} failed at step ${event.failedStep}`;
    default:
      return event.type;
  }
};
