import { TypemoClient } from "@venloc/typemo";

const client = await TypemoClient.connect("mongodb://localhost:27017/app");
console.log(client.state, client.supportsTransactions);
// → connected true
await client.close();
