import { TypemoClient } from "@venloc/typemo";
// ---cut---
let captured: TypemoClient;
{
  await using client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
  captured = client;
}
console.log(captured.state);
// → "closed"
