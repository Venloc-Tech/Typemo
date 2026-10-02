import type { InstrumentationErrorEvent } from "@venloc/typemo";
// ---cut---
const onFailure = (event: InstrumentationErrorEvent): void => {
  console.warn(`mask for ${event.model}.${event.path} failed: ${String(event.error)}`);
};
