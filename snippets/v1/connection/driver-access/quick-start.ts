import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
const pong = await client.unsafeDriver().db("admin").command({ ping: 1 });
console.log(pong.ok);
// → 1
