import { TypemoClient } from "@venloc/typemo";
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app", readyTimeoutMS: 5_000 });
// ---cut---
await client.ready(1_000);
