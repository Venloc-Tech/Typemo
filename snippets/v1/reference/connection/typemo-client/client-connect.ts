import { TypemoClient } from "@venloc/typemo";
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
await client.connect();
await client.connect(); // the second call does nothing
