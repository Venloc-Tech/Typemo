import { Typemo, TypemoClient, type SchemaPlugin } from "@venloc/typemo";
const readLog: SchemaPlugin = { name: "read-log", apply: () => {} };
const stamped: SchemaPlugin = { name: "stamped", apply: () => {} };
// ---cut---
Typemo.plugin(readLog); // every client, every model

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
client.db().plugins.use(stamped); // only the models of this database
