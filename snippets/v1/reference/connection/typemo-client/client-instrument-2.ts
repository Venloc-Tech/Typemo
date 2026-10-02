import { TypemoClient } from "@venloc/typemo";
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
{
  using subscription = client.instrument({ handle: (event) => console.log(event.type) });
  // events arrive inside the block
}
// the subscription is already removed here
