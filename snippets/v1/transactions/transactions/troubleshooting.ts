import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const raw = client.unsafeDriver().db("app").collection("accounts");
// ---cut---
await client.transaction(async (scope) => {
  await raw.insertOne({ title: "Raw", balance: 1 }, { session: scope.session }); // [!code highlight]
});
