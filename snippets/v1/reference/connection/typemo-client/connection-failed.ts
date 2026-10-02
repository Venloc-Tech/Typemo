import { TypemoClient } from "@venloc/typemo";
// ---cut---
try {
  await TypemoClient.connect("mongodb://127.0.0.1:1/", { serverSelectionTimeoutMS: 300 });
} catch (error) {
  console.log(String(error));
  // → "ConnectionError: no server available: connect ECONNREFUSED 127.0.0.1:1"
}
