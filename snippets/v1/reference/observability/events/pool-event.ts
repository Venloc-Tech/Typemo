import type { PoolEvent } from "@venloc/typemo";
// ---cut---
const onPool = (event: PoolEvent): void => {
  console.log(event.name, event.address);
};
// → "connectionCheckedOut 127.0.0.1:27017"
