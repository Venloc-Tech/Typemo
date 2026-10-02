import { CollectionManager, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const db = client.unsafeDriver().db("app");
await db.createCollection("ledger", { capped: true, size: 1024, max: 100 });
// ---cut---
const info = await CollectionManager.info(db, "ledger");
console.log(info?.name, info?.type, info?.options);
// → "ledger" "collection" { capped: true, size: 1024, max: 100 }

console.log(await CollectionManager.info(db, "missing"));
// → undefined
