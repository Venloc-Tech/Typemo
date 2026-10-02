import { Pipeline, TypemoClient } from "@venloc/typemo";

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
const query = client.aggregate(Pipeline.database().documents([{ n: 1 }, { n: 2 }, { n: 3 }]).plan());

const seen: number[] = [];
for await (const row of query.cursor()) seen.push(row.n);
console.log(seen);
// → [1, 2, 3]
