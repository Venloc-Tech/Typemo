import { ConnectionError, TypemoClient } from "@venloc/typemo";
// ---cut---
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
await client.close();

try {
  await client.startSession();
} catch (error) {
  if (error instanceof ConnectionError) {
    console.log(error.failure);
    // → "closed"
    console.log(error.message);
    // → TypemoClient "default" is closed; create a new client
  }
}
