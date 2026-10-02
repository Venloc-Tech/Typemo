import { Pipeline, TypemoClient } from "@venloc/typemo";

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
const live = await client.aggregate(Pipeline.database().listLocalSessions({ allUsers: true }).plan());
console.log(live.length > 0);
// → true

const stored = await client.aggregate(Pipeline.sessions().listSessions({ allUsers: true }).plan());
console.log(stored.length);
// → 0
