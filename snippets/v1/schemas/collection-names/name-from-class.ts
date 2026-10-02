import { CollectionNaming } from "@venloc/typemo";
// ---cut---
console.log(["Person", "Category", "Status", "Data"].map(CollectionNaming.default).join(" "));
// → people categories status data
