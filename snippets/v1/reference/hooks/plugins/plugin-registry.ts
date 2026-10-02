import { TypemoClient, type SchemaPlugin } from "@venloc/typemo";
const audit: SchemaPlugin = { name: "audit-log", apply: () => {} };
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
client.db().plugins.use(audit);
console.log(client.db().plugins.list.map((entry) => `${entry.level}:${entry.plugin.name}`));
// → ["connection:audit-log"]
