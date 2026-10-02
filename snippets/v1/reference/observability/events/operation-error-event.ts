import type { OperationErrorEvent } from "@venloc/typemo";
// ---cut---
const onError = (event: OperationErrorEvent): void => {
  const { kind, name, retryable } = event.classification;
  console.error(`${event.operation}: ${name} (${kind}), шаг ${event.failedStep}, повтор ${retryable}`);
};
// → "find: DocumentNotFoundError (not-found), шаг postProcess, повтор false"
