import { TypemoClient } from "@venloc/typemo";
// ---cut---
const fromUri = new TypemoClient("mongodb://localhost:27017/reports");
console.log(fromUri.options.dbName);
// → "reports"
const fallback = new TypemoClient("mongodb://localhost:27017");
console.log(fallback.options.dbName, fallback.options.readyTimeoutMS);
// → "test" 10000
