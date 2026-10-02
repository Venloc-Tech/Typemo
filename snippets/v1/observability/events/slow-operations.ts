import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
// ---cut---
const SLOW_MS = 100;

client.instrument({
  handle: (event) => {
    if (event.type === "operation.end" && event.durationMS > SLOW_MS) {
      console.warn(`slow: ${event.model ?? event.database}.${event.operation}, ${Math.round(event.durationMS)} ms`);
    }
  },
});
