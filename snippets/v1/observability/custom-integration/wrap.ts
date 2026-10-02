import { TypemoClient } from "@venloc/typemo";
import { AsyncLocalStorage } from "node:async_hooks";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
// ---cut---
const current = new AsyncLocalStorage<number>();

client.instrument({
  handle: () => {},
  wrap: (operation, run) => current.run(operation.operationId, run),
});
