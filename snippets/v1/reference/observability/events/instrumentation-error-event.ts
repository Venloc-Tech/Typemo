import type { InstrumentationErrorEvent } from "@venloc/typemo";
// ---cut---
const onFailure = (event: InstrumentationErrorEvent): void => {
  console.warn(`маска для ${event.model}.${event.path} упала: ${String(event.error)}`);
};
