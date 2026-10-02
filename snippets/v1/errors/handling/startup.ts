import { SyncError, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
try {
  await client.connection.init();
} catch (error) {
  if (error instanceof SyncError) {
    for (const failure of error.failures) console.error(failure.kind, failure.name, failure.errors.map((e) => e.message));
  }
  throw error;
}
