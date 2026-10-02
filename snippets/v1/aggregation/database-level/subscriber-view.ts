import { Pipeline, TypemoClient } from "@venloc/typemo";

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
const events: string[] = [];
const subscription = client.instrument({
  handle: (event) => {
    if (event.type === "operation.end") {
      events.push(`${event.operation} model=${event.model} collection=${event.collection} database=${event.database}`);
    }
  },
});

await client.aggregate(Pipeline.database().documents([{ n: 1 }]).plan());
await client.aggregate(Pipeline.sessions().listSessions({ allUsers: true }).plan());
subscription.unsubscribe();
console.log(events);
// → ["aggregate model=null collection=null database=shop", "aggregate model=null collection=system.sessions database=config"]
