import type { StepEvent } from "@venloc/typemo";
// ---cut---
const onStep = (event: StepEvent): void => {
  console.log(event.operationId, event.step, event.durationMS);
};
