import { Pipeline, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
// ---cut---
client.instrument({
  handle: (event) => {
    if (event.type === "operation.end") {
      console.log(`${event.model ?? `database ${event.database}`}: ${event.operation}`);
    }
  },
});

await client.connection.aggregate(Pipeline.database().documents([{ n: 1 }]).plan());
// → "database bank: aggregate"
