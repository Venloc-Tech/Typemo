import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
// ---cut---
client.instrument({
  handle: (event) => {
    if (event.type === "operation.error") {
      const { kind, name, retryable } = event.classification;
      console.error(`${event.operation}: ${name} (${kind}), step ${event.failedStep}, retryable: ${retryable}`);
    }
  },
});
