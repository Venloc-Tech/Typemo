import { TypemoClient } from "@venloc/typemo";
const client = new TypemoClient("mongodb://localhost:27017/app");
// ---cut---
const stop = client.onStateChange((state) => console.log("db:", state));
await client.connect();
// → "db: connecting"
// → "db: connected"
await client.close();
// → "db: closed"
stop();
