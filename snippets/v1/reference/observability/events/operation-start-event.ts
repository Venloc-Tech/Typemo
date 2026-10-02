import type { OperationStartEvent } from "@venloc/typemo";
// ---cut---
const onStart = (event: OperationStartEvent): void => {
  console.log(event.type, event.operation, JSON.stringify(event.summary.filter));
};
// for find: "operation.start find {"balance":{"$gt":"?"}}"
