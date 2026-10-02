import type { OperationEndEvent } from "@venloc/typemo";
// ---cut---
const onEnd = (event: OperationEndEvent): void => {
  console.log(`${event.operation}: ${event.durationMS.toFixed(1)} мс, документов: ${event.documentCount}`);
};
// → "find: 2.3 мс, документов: 1"
