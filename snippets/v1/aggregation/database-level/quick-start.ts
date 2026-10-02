import { Pipeline, TypemoClient } from "@venloc/typemo";

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
const numbers = await client.aggregate(
  Pipeline.database()
    .documents([{ n: 1 }, { n: 2 }, { n: 3 }])
    .match({ n: { $gt: 1 } })
    .plan(),
);
console.log(numbers);
// → [{ n: 2 }, { n: 3 }]

const operations = await client.aggregate(Pipeline.admin().currentOp({ idleConnections: false }).limit(1).plan());
console.log(operations.length);
// → 1

const sessions = await client.aggregate(Pipeline.sessions().listSessions({ allUsers: true }).plan());
//    ^?
