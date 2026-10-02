import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
if (client.supportsTransactions === false) {
  throw new Error("MongoDB must run as a replica set: transactions are not supported");
}
