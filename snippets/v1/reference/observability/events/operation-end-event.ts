import type { OperationEndEvent } from "@venloc/typemo";
// ---cut---
const onEnd = (event: OperationEndEvent): void => {
  console.log(`${event.operation}: ${event.durationMS.toFixed(1)} ms, documents: ${event.documentCount}`);
};
// → "find: 2.3 ms, documents: 1"
