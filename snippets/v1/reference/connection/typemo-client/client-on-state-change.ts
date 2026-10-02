import { TypemoClient } from "@venloc/typemo";
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
const stop = client.onStateChange((state) => console.log(state));
await client.connect();
// → "connecting"
// → "connected"
await client.close();
// → "closed"
stop();
