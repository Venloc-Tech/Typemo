import type { TransactionEvent } from "@venloc/typemo";
// ---cut---
const onTransaction = (event: TransactionEvent): void => {
  if (event.type === "transaction.abort") console.warn("откат", event.transactionId, event.error);
};
