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
      console.log(`${event.commandName} на ${event.address}: ${event.durationMS} мс`);
    }
    if (event.type === "driver.pool") console.log(event.name);
  },
});
