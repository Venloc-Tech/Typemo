import { TypemoClient } from "@venloc/typemo";
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
const reports = client.connection.useDb("reports");
console.log(reports.name, reports === client.db("reports"));
// → "reports" true
