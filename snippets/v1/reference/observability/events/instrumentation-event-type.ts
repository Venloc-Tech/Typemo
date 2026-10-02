import type { InstrumentationEventType } from "@venloc/typemo";
// ---cut---
const interesting = new Set<InstrumentationEventType>(["operation.end", "operation.error"]);
