import { TypemoClient } from "@venloc/typemo";
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
const subscription = client.instrument({
  handle: (event) => {
    if (event.type === "operation.end") console.log(event.operation, event.durationMS);
  },
});
subscription.unsubscribe();
