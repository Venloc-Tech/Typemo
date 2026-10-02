import { Pipeline, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
const running = await client.aggregate(Pipeline.admin().currentOp({ idleConnections: false }).plan());
console.log(running.length > 0);
// → true
const rows = await client.aggregate(Pipeline.database().documents([{ n: 1 }]).plan());
console.log(rows);
// → [{ n: 1 }]
