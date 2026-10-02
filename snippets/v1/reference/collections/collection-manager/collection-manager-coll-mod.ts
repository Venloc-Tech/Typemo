import { CollectionManager } from "@venloc/typemo";
// ---cut---
const command = CollectionManager.collMod(
  "ledger",
  { capped: true, size: 65_536, max: 100 },
  [{ option: "size", mutable: true, wanted: 65_536, actual: 1024 }],
);
console.log(command);
// → { collMod: "ledger", cappedSize: 65536 }
