import { TypemoClient } from "@venloc/typemo";
// a client without monitorCommands
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
// ---cut---
client.instrument({ handle: () => {}, driverCommands: true });
// at runtime: ConfigurationError
