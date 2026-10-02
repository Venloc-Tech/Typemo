import { TypemoClient } from "@venloc/typemo";
// ---cut---
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app", name: "main" });
console.log(client.state);
// → "idle"
