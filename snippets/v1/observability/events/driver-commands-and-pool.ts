import { TypemoClient } from "@venloc/typemo";
// ---cut---
const client = await TypemoClient.connect("mongodb://localhost:27017", {
  dbName: "bank",
  monitorCommands: true,
});

client.instrument({
  driverCommands: true,
  poolEvents: true,
  handle: (event) => {
    if (event.type === "driver.command.succeeded") {
      console.log(`${event.commandName} on ${event.address}: ${event.durationMS} ms`);
    }
    if (event.type === "driver.pool") console.log(event.name);
  },
});
