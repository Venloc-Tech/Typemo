import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
// ---cut---
{
  using subscription = client.instrument({ handle: (event) => console.log(event.type) });
  // events arrive while this block runs
}
// the subscription is already removed here
