import { CollectionNaming } from "@venloc/typemo";
// ---cut---
try {
  CollectionNaming.check("system.users", "Client");
} catch (error) {
  console.log((error as Error).message);
}
// → Client: "system." collections are reserved
