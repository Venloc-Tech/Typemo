import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank", monitorCommands: true });
// ---cut---
client.instrument({
  steps: false,
  poolEvents: true,
  driverCommands: false,
  handle: (event) => {
    if (event.type === "driver.pool") console.log(event.name, event.address);
  },
});
