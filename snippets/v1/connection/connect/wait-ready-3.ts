import { TypemoClient } from "@venloc/typemo";
const client = new TypemoClient("mongodb://localhost:27017/app");
// ---cut---
await client.ready(0);
