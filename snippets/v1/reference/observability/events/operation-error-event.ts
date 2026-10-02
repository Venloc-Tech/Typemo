import type { OperationErrorEvent } from "@venloc/typemo";
// ---cut---
const onError = (event: OperationErrorEvent): void => {
  const { kind, name, retryable } = event.classification;
  console.error(`${event.operation}: ${name} (${kind}), step ${event.failedStep}, retryable ${retryable}`);
};
// → "find: DocumentNotFoundError (not-found), step postProcess, retryable false"
