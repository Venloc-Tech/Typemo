import type { OperationSummary } from "@venloc/typemo";
// ---cut---
const summary: OperationSummary = { filter: { balance: { $gt: "?" } }, sort: { balance: 1 } };
