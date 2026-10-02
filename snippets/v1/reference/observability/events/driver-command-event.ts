import type { DriverCommandEvent } from "@venloc/typemo";
// ---cut---
const onCommand = (event: DriverCommandEvent): void => {
  if (event.type === "driver.command.succeeded") {
    console.log(`${event.commandName} на ${event.address}: ${event.durationMS} мс`);
  }
};
// → "find на 127.0.0.1:27017: 1 мс"
