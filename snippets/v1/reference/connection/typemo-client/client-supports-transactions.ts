import { TypemoClient } from "@venloc/typemo";
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
console.log(client.supportsTransactions);
// → undefined
await client.connect();
console.log(client.supportsTransactions);
// → true  (on a replica set)
