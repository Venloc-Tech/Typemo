import { TypemoClient } from "@venloc/typemo";
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
const app = client.db();
const reports = client.db("reports");
console.log(app.name, reports.name);
// → "app" "reports"
console.log(client.db("reports") === reports);
// → true
