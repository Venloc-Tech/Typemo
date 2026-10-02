import { TypemoClient } from "@venloc/typemo";
// ---cut---
process.env.NODE_ENV = "production";
console.log(new TypemoClient("mongodb://localhost:27017", { validateReads: "development" }).options.validateReads);
// → false
process.env.NODE_ENV = "development";
console.log(new TypemoClient("mongodb://localhost:27017", { validateReads: "development" }).options.validateReads);
// → true
