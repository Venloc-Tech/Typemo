import { TypemoClient } from "@venloc/typemo";
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
const connection = client.connection;
console.log(connection.name, connection.client === client);
// → "app" true
