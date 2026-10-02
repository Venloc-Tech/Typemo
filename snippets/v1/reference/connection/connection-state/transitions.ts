import { TypemoClient } from "@venloc/typemo";
// ---cut---
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
client.onStateChange((state) => console.log(state));
await client.connect();
// → "connecting"
// → "connected"
await client.close();
// → "closed"
