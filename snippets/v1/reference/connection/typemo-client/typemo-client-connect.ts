import { TypemoClient } from "@venloc/typemo";
// ---cut---
const client = await TypemoClient.connect("mongodb://localhost:27017/app", { timeoutMS: 30_000 });
console.log(client.state);
// → "connected"
