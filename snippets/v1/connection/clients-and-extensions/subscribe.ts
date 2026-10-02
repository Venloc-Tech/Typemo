import { Typemo } from "@venloc/typemo";

Typemo.instrument({
  handle: (event) => {
    if (event.type === "operation.end") console.log(`${event.connection}/${event.database}: ${event.operation}`);
  },
});
// → "main/app: insertOne"
// → "reports/reports: find"
