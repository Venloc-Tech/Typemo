import { Pipeline, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
// ---cut---
const rows = await connection.aggregate(
  Pipeline.database()
    .documents([{ n: 1 }, { n: 2 }, { n: 3 }])
    .match({ n: { $gt: 1 } })
    .plan(),
);
console.log(rows);
// → [{ n: 2 }, { n: 3 }]
