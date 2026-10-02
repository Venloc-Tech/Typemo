import { TypemoClient } from "@venloc/typemo";
// ---cut---
const fromUri = new TypemoClient("mongodb://localhost:27017/reports");
console.log(fromUri.options.dbName);
// → "reports"

const fromOption = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
console.log(fromOption.options.dbName);
// → "app"

const fallback = new TypemoClient("mongodb://localhost:27017");
console.log(fallback.options.dbName);
// → "test"
