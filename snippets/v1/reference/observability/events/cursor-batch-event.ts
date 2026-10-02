import type { CursorBatchEvent } from "@venloc/typemo";
// ---cut---
const onBatch = (event: CursorBatchEvent): void => {
  console.log(`пачка ${event.batch}: ${event.size} документов`);
};
// → "пачка 0: 2 документа"
