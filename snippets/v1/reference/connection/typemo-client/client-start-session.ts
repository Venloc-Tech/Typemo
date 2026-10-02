import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
const session = await client.startSession();
try {
  // operations with .session(session)
} finally {
  await session.endSession();
}
