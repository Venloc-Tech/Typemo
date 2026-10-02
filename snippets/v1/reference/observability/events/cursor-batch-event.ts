import type { CursorBatchEvent } from "@venloc/typemo";
// ---cut---
const onBatch = (event: CursorBatchEvent): void => {
  console.log(`batch ${event.batch}: ${event.size} documents`);
};
// → "batch 0: 2 documents"
