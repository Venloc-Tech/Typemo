import { Typemo } from "@venloc/typemo";
// ---cut---
const subscription = Typemo.instrument({
  handle: (event) => {
    if (event.type === "operation.end") {
      console.log(`${event.connection}/${event.database}: ${event.operation}`);
    }
  },
});
subscription.unsubscribe();
