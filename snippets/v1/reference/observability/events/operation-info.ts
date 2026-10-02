import type { OperationInfo } from "@venloc/typemo";
// ---cut---
const label = (info: OperationInfo): string =>
  `${info.connection}/${info.database}.${info.collection ?? "*"} ${info.operation}` +
  (info.populatePath === undefined ? "" : ` (populate ${info.populatePath})`);
// for find on accounts: "default/bank.accounts find"; for an aggregation over the whole database: "default/bank.* aggregate"
